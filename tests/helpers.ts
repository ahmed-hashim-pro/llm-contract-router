import { defineContract } from "../src/core/contract.js";
import { withPricing } from "../src/core/models.js";
import type { Contract, ModelSpec, Tier } from "../src/core/types.js";

export const sentimentSchema = {
  type: "object",
  properties: {
    sentiment: { type: "string", enum: ["positive", "negative", "neutral"] },
    score: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["sentiment", "score"],
} as const;

export interface Sentiment {
  sentiment: "positive" | "negative" | "neutral";
  score: number;
}

/**
 * A hand-written contract, which also demonstrates that the library needs no
 * validation library at all.
 */
export const sentimentContract: Contract<Sentiment> = defineContract(
  "sentiment",
  sentimentSchema,
  (value) => {
    const problems: string[] = [];
    if (value === null || typeof value !== "object") {
      return { ok: false, problems: ["expected a JSON object"] };
    }
    const record = value as Record<string, unknown>;
    const sentiment = record["sentiment"];
    const score = record["score"];

    if (!["positive", "negative", "neutral"].includes(sentiment as string)) {
      problems.push("sentiment: must be one of positive, negative, neutral");
    }
    if (typeof score !== "number" || score < 0 || score > 1) {
      problems.push("score: must be a number between 0 and 1");
    }
    return problems.length === 0
      ? { ok: true, value: { sentiment: sentiment as Sentiment["sentiment"], score: score as number } }
      : { ok: false, problems };
  },
);

export function model(id: string, tier: Tier, provider = "mock"): ModelSpec {
  return withPricing(
    { id, provider, tier },
    // Round numbers so cost assertions read clearly: 1000 in + 500 out = $0.01.
    { inputPerMTok: 5, outputPerMTok: 10 },
  );
}

export const VALID = JSON.stringify({ sentiment: "positive", score: 0.9 });
export const INVALID = JSON.stringify({ sentiment: "elated", score: 3 });
