/**
 * The capability tier of a model.
 *
 * Tier is the whole point of this library: it decides how much scaffolding a
 * request needs. A frontier model given a heavy-handed prompt gets worse, not
 * better; a compact model given a terse one returns prose where JSON was asked
 * for. The same call therefore does not produce the same request.
 */
export type Tier = "frontier" | "balanced" | "compact";

/** A model the router can route to. */
export interface ModelSpec {
  /** Provider-specific model id, sent verbatim. */
  readonly id: string;
  /** Which registered provider serves it. */
  readonly provider: string;
  readonly tier: Tier;
  /** USD per million input tokens. */
  readonly inputPerMTok: number;
  /** USD per million output tokens. */
  readonly outputPerMTok: number;
  readonly maxOutputTokens?: number;
}

/** What a provider is asked to do. Deliberately smaller than any vendor API. */
export interface ProviderRequest {
  readonly model: string;
  readonly system: string;
  readonly prompt: string;
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly signal?: AbortSignal;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ProviderResponse {
  readonly text: string;
  readonly usage: TokenUsage;
}

/**
 * Why an attempt failed, in the only terms the router acts on.
 *
 * Vendors disagree about status codes and error shapes, so adapters classify
 * once and the routing logic never sees a vendor error again.
 */
export type FailureKind =
  /** Retry later; the model itself is fine. Falls over immediately. */
  | "rate_limit"
  /** Provider fault: 5xx, connection reset. Falls over immediately. */
  | "unavailable"
  /** The request exceeded its deadline. */
  | "timeout"
  /** Bad key, no credit, permission denied. Falls over; retrying will not help. */
  | "auth"
  /** The request was malformed or too large for this model. */
  | "invalid_request"
  /** The model answered, but not in the shape the contract requires. */
  | "contract"
  /** Anything an adapter could not classify. */
  | "unknown";

/** An error a provider adapter raises, already classified. */
export class ProviderError extends Error {
  readonly kind: FailureKind;
  readonly provider: string;
  override readonly cause?: unknown;

  constructor(
    kind: FailureKind,
    provider: string,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.provider = provider;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * The seam this library owns.
 *
 * Everything vendor-specific lives behind this interface, which is why the core
 * has no dependencies. Writing an adapter for a provider that does not exist yet
 * means implementing one method and classifying its errors.
 */
export interface Provider {
  readonly name: string;
  complete(request: ProviderRequest): Promise<ProviderResponse>;
}

/**
 * A validated output shape.
 *
 * Structural rather than tied to a validation library, so zod 3, zod 4, valibot
 * or a hand-written function all satisfy it. `schema` is what gets shown to the
 * model; `validate` is what decides whether the answer counts.
 */
export interface Contract<T> {
  readonly name: string;
  /** JSON Schema (or any JSON-serialisable description) injected into the prompt. */
  readonly schema: unknown;
  validate(value: unknown): ContractResult<T>;
}

export type ContractResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problems: readonly string[] };
