import type { FailureKind, Tier } from "./types.js";

/** One model's turn, whether or not it worked. */
export interface Attempt {
  readonly model: string;
  readonly provider: string;
  readonly tier: Tier;
  /** 0 for the first call to this model, 1 for the repair retry. */
  readonly repair: number;
  readonly outcome: "ok" | "failed";
  readonly failure?: FailureKind;
  readonly reason?: string;
  /** Validation problems, when the failure was `contract`. */
  readonly problems?: readonly string[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly latencyMs: number;
}

/**
 * What happened, in enough detail to explain a bill or a bad answer.
 *
 * `costUsd` is the sum across every attempt — repairs and abandoned models
 * included. A degraded path can therefore cost more than the primary would
 * have; see `maxCostUsd` on the router if that matters more than the answer.
 */
export interface RouteMeta {
  readonly servedBy?: string;
  readonly tier?: Tier;
  /** True when the answer came from anything other than the first model tried. */
  readonly degraded: boolean;
  readonly attempts: readonly Attempt[];
  readonly repairs: number;
  readonly costUsd: number;
  readonly latencyMs: number;
}

export type RouterErrorKind =
  /** Every model in the chain failed. `attempts` says how each one did. */
  | "chain_exhausted"
  /** Stopping would have cost more than `maxCostUsd` allowed. */
  | "budget_exceeded"
  /** The router was misconfigured; no request was ever sent. */
  | "configuration";

export interface RouterError {
  readonly kind: RouterErrorKind;
  readonly message: string;
}

/**
 * A discriminated union rather than a thrown error.
 *
 * `meta` is most valuable in the failing case — which models were tried, why
 * each was rejected, and what the attempt cost — and an exception either loses
 * that or smuggles it onto an Error subclass, which is worse to consume.
 */
export type RouteResult<T> =
  | { readonly ok: true; readonly data: T; readonly meta: RouteMeta }
  | { readonly ok: false; readonly error: RouterError; readonly meta: RouteMeta };
