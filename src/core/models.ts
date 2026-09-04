import type { ModelSpec, Tier } from "./types.js";

/** A model's identity and tier — everything except what it costs. */
export interface ModelIdentity {
  readonly id: string;
  readonly provider: string;
  readonly tier: Tier;
  readonly maxOutputTokens?: number;
}

export interface Pricing {
  /** USD per million input tokens. */
  readonly inputPerMTok: number;
  /** USD per million output tokens. */
  readonly outputPerMTok: number;
}

/**
 * Known models, by identity and tier only.
 *
 * Prices are deliberately absent. They change far more often than this package
 * is released, and a stale number baked into a library is worse than no number:
 * it reports a cost that looks authoritative and is wrong. Tier is a judgement
 * about capability that ages much more slowly, so that is what ships.
 *
 * Supply pricing from your provider's current page with {@link withPricing}.
 *
 * Only models whose ids are verified are listed. Reach for {@link defineModel}
 * for anything else — a guessed id fails at request time with a provider error
 * that looks like an outage, which is a worse trade than typing it yourself.
 */
export const models = {
  anthropic: {
    opus5: { id: "claude-opus-5", provider: "anthropic", tier: "frontier" },
    sonnet5: { id: "claude-sonnet-5", provider: "anthropic", tier: "balanced" },
    haiku45: { id: "claude-haiku-4-5-20251001", provider: "anthropic", tier: "compact" },
  },
} as const satisfies Record<string, Record<string, ModelIdentity>>;

/** Attaches current pricing to a model identity, producing a routable spec. */
export function withPricing(identity: ModelIdentity, pricing: Pricing): ModelSpec {
  if (pricing.inputPerMTok < 0 || pricing.outputPerMTok < 0) {
    throw new Error(`${identity.id}: pricing cannot be negative`);
  }
  return {
    id: identity.id,
    provider: identity.provider,
    tier: identity.tier,
    inputPerMTok: pricing.inputPerMTok,
    outputPerMTok: pricing.outputPerMTok,
    ...(identity.maxOutputTokens !== undefined
      ? { maxOutputTokens: identity.maxOutputTokens }
      : {}),
  };
}

/** Defines a model this package has never heard of. */
export function defineModel(identity: ModelIdentity, pricing: Pricing): ModelSpec {
  return withPricing(identity, pricing);
}
