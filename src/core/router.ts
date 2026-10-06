import { buildRepairPrompt, buildSystemPrompt, defaultCalibration } from "./calibration.js";
import type { TierCalibration } from "./calibration.js";
import { extractJson } from "./extract.js";
import type { Attempt, RouteMeta, RouteResult, RouterError } from "./result.js";
import type { Contract, FailureKind, ModelSpec, Provider, Tier } from "./types.js";
import { ProviderError } from "./types.js";

export interface RouterConfig {
  /** Registered providers, keyed by the name a ModelSpec refers to. */
  readonly providers: Readonly<Record<string, Provider>>;
  /** Models to try, in order. The first is the primary. */
  readonly chain: readonly ModelSpec[];
  /** Overrides for how each tier is prompted. */
  readonly calibration?: Partial<Record<Tier, Partial<TierCalibration>>>;
  /** Repair attempts allowed per model after a contract failure. Default 1. */
  readonly repairsPerModel?: number;
  /**
   * A soft ceiling: before each attempt, stop if spend has already reached
   * this. An attempt that has started is never cut short, so the attempt that
   * crosses the line is still counted and the final cost can exceed it.
   * Cost accumulates across repairs and abandoned models, so a degraded path
   * can otherwise cost more than the primary would have.
   */
  readonly maxCostUsd?: number;
  readonly timeoutMs?: number;
  readonly maxOutputTokens?: number;
}

export interface CompleteOptions<T> {
  readonly prompt: string;
  readonly contract: Contract<T>;
  readonly signal?: AbortSignal;
}

export interface Router {
  complete<T>(options: CompleteOptions<T>): Promise<RouteResult<T>>;
}

export function createRouter(config: RouterConfig): Router {
  const repairsPerModel = config.repairsPerModel ?? 1;
  const timeoutMs = config.timeoutMs ?? 30_000;

  return {
    async complete<T>(options: CompleteOptions<T>): Promise<RouteResult<T>> {
      const startedAt = Date.now();
      const attempts: Attempt[] = [];
      const primaryId = config.chain[0]?.id;

      const configError = validate(config);
      if (configError !== null) {
        return { ok: false, error: configError, meta: summarise(attempts, startedAt, undefined, primaryId) };
      }

      for (const model of config.chain) {
        // A missing provider is a configuration bug, but it must not take out a
        // chain whose remaining entries are fine.
        const provider = config.providers[model.provider];
        if (provider === undefined) {
          attempts.push(failedAttempt(model, 0, "configuration" as FailureKind, `no provider registered as "${model.provider}"`));
          continue;
        }

        const calibration = calibrationFor(model.tier, config.calibration);
        const system = buildSystemPrompt(options.contract, calibration);
        let prompt = options.prompt;

        for (let repair = 0; repair <= repairsPerModel; repair++) {
          if (overBudget(attempts, config.maxCostUsd)) {
            return {
              ok: false,
              error: {
                kind: "budget_exceeded",
                message: `stopped after $${totalCost(attempts).toFixed(6)}, which reached the $${config.maxCostUsd?.toFixed(6)} budget`,
              },
              meta: summarise(attempts, startedAt, undefined, primaryId),
            };
          }

          const attemptStart = Date.now();
          let response;
          try {
            response = await callWithTimeout(provider, {
              model: model.id,
              system,
              prompt,
              temperature: calibration.temperature,
              maxOutputTokens: model.maxOutputTokens ?? config.maxOutputTokens ?? 2048,
              ...(options.signal ? { signal: options.signal } : {}),
            }, timeoutMs);
          } catch (error) {
            const kind = classify(error);
            attempts.push(failedAttempt(model, repair, kind, describe(error)));
            break; // provider-level failures are never worth a repair
          }

          const cost = costOf(model, response.usage);
          const latencyMs = Date.now() - attemptStart;

          const parsed = extractJson(response.text);
          const problems = parsed.ok
            ? checkContract(options.contract, parsed.value)
            : [parsed.problem];

          if (problems === null) {
            const value = options.contract.validate(parsed.ok ? parsed.value : null);
            /* c8 ignore next -- checkContract already proved this branch */
            if (!value.ok) break;
            attempts.push({
              model: model.id, provider: model.provider, tier: model.tier, repair,
              outcome: "ok",
              inputTokens: response.usage.inputTokens,
              outputTokens: response.usage.outputTokens,
              costUsd: cost, latencyMs,
            });
            return {
              ok: true,
              data: value.value,
              meta: summarise(attempts, startedAt, model, primaryId),
            };
          }

          attempts.push({
            model: model.id, provider: model.provider, tier: model.tier, repair,
            outcome: "failed", failure: "contract",
            reason: "the answer did not satisfy the contract",
            problems,
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            costUsd: cost, latencyMs,
          });

          if (repair < repairsPerModel) {
            prompt = buildRepairPrompt(options.prompt, response.text, problems);
          }
        }
      }

      return {
        ok: false,
        error: {
          kind: "chain_exhausted",
          message: `every model in the chain failed (${config.chain.length} tried)`,
        },
        meta: summarise(attempts, startedAt, undefined, primaryId),
      };
    },
  };
}

function validate(config: RouterConfig): RouterError | null {
  if (config.chain.length === 0) {
    return { kind: "configuration", message: "chain is empty: give the router at least one model" };
  }
  if (Object.keys(config.providers).length === 0) {
    return { kind: "configuration", message: "no providers registered" };
  }
  if (config.repairsPerModel !== undefined && config.repairsPerModel < 0) {
    return { kind: "configuration", message: "repairsPerModel cannot be negative" };
  }
  return null;
}

/** Returns null when the value satisfies the contract, or the problems if not. */
function checkContract(contract: Contract<unknown>, value: unknown): string[] | null {
  const result = contract.validate(value);
  return result.ok ? null : [...result.problems];
}

function calibrationFor(
  tier: Tier,
  overrides: RouterConfig["calibration"],
): TierCalibration {
  return { ...defaultCalibration[tier], ...overrides?.[tier] };
}

async function callWithTimeout(
  provider: Provider,
  request: Parameters<Provider["complete"]>[0],
  timeoutMs: number,
) {
  const timer = AbortSignal.timeout(timeoutMs);
  const signal = request.signal
    ? AbortSignal.any([request.signal, timer])
    : timer;
  try {
    return await provider.complete({ ...request, signal });
  } catch (error) {
    if (timer.aborted) {
      throw new ProviderError("timeout", provider.name, `no response within ${timeoutMs}ms`, { cause: error });
    }
    throw error;
  }
}

function classify(error: unknown): FailureKind {
  if (error instanceof ProviderError) return error.kind;
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  return "unknown";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failedAttempt(
  model: ModelSpec,
  repair: number,
  failure: FailureKind,
  reason: string,
): Attempt {
  return {
    model: model.id, provider: model.provider, tier: model.tier, repair,
    outcome: "failed", failure, reason,
    inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0,
  };
}

/** Cost is per million tokens, which is how every provider quotes it. */
export function costOf(model: ModelSpec, usage: { inputTokens: number; outputTokens: number }): number {
  return (
    (usage.inputTokens / 1_000_000) * model.inputPerMTok +
    (usage.outputTokens / 1_000_000) * model.outputPerMTok
  );
}

function totalCost(attempts: readonly Attempt[]): number {
  return attempts.reduce((sum, attempt) => sum + attempt.costUsd, 0);
}

function overBudget(attempts: readonly Attempt[], maxCostUsd: number | undefined): boolean {
  return maxCostUsd !== undefined && totalCost(attempts) >= maxCostUsd;
}

function summarise(
  attempts: readonly Attempt[],
  startedAt: number,
  servedBy: ModelSpec | undefined,
  primaryId: string | undefined,
): RouteMeta {
  return {
    ...(servedBy ? { servedBy: servedBy.id, tier: servedBy.tier } : {}),
    // Strictly "a model other than the primary served this". Repairs are
    // reported by `repairs`; a caller wanting "anything non-ideal happened"
    // checks `degraded || repairs > 0`. Two fields, two signals.
    degraded: servedBy !== undefined && servedBy.id !== primaryId,
    attempts: [...attempts],
    repairs: attempts.filter((attempt) => attempt.repair > 0).length,
    costUsd: totalCost(attempts),
    latencyMs: Date.now() - startedAt,
  };
}
