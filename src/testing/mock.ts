import type { FailureKind, Provider, ProviderRequest, ProviderResponse } from "../core/types.js";
import { ProviderError } from "../core/types.js";

/** One scripted turn. */
export type MockTurn =
  | { readonly text: string; readonly usage?: Partial<ProviderResponse["usage"]> }
  | { readonly fail: FailureKind; readonly message?: string }
  | ((request: ProviderRequest) => ProviderResponse | Promise<ProviderResponse>);

export interface MockProvider extends Provider {
  /** Every request the router sent, in order. */
  readonly calls: readonly ProviderRequest[];
  /** How many turns are left unconsumed. */
  readonly remaining: number;
}

/**
 * A provider that answers from a script.
 *
 * Exported as part of the public API rather than kept in the test folder: the
 * hard part of testing an application built on this router is simulating a
 * provider that rate-limits, times out, or returns almost-valid JSON, and that
 * is exactly what this does.
 *
 * The last turn repeats once the script runs out, so a test that only cares
 * about the first failure does not have to pad the script.
 */
export function createMockProvider(name: string, script: readonly MockTurn[]): MockProvider {
  if (script.length === 0) {
    throw new Error("createMockProvider needs at least one scripted turn");
  }
  const calls: ProviderRequest[] = [];
  let index = 0;

  return {
    name,
    get calls() {
      return calls;
    },
    get remaining() {
      return Math.max(0, script.length - index);
    },
    async complete(request: ProviderRequest): Promise<ProviderResponse> {
      calls.push(request);
      const turn = script[Math.min(index, script.length - 1)]!;
      index++;

      if (typeof turn === "function") return turn(request);

      if ("fail" in turn) {
        throw new ProviderError(turn.fail, name, turn.message ?? `mock ${name}: ${turn.fail}`);
      }
      return {
        text: turn.text,
        usage: {
          inputTokens: turn.usage?.inputTokens ?? 100,
          outputTokens: turn.usage?.outputTokens ?? 50,
        },
      };
    },
  };
}

/** A provider that never answers, for exercising timeouts. */
export function createHangingProvider(name: string): Provider {
  return {
    name,
    complete(request: ProviderRequest): Promise<ProviderResponse> {
      return new Promise((_resolve, reject) => {
        request.signal?.addEventListener("abort", () => {
          reject(new ProviderError("timeout", name, `mock ${name}: aborted`));
        });
      });
    },
  };
}
