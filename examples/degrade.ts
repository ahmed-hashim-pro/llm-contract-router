/**
 * Watch a request degrade, without spending anything.
 *
 * The primary rate-limits, the backup returns almost-valid JSON, gets told
 * exactly what was wrong, and its second answer is accepted. Run it with:
 *
 *   npm run example
 */
import { createRouter, defineContract, withPricing, models } from "../dist/index.js";
import type { ContractResult } from "../dist/index.js";
import { createMockProvider } from "../dist/testing/index.js";

interface Sentiment {
  sentiment: "positive" | "negative" | "neutral";
  score: number;
}

const contract = defineContract<Sentiment>(
  "sentiment",
  {
    type: "object",
    properties: {
      sentiment: { type: "string", enum: ["positive", "negative", "neutral"] },
      score: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["sentiment", "score"],
  },
  (value): ContractResult<Sentiment> => {
    const record = value as Record<string, unknown> | null;
    const problems: string[] = [];
    if (record === null || typeof record !== "object") {
      return { ok: false, problems: ["expected a JSON object"] };
    }
    if (!["positive", "negative", "neutral"].includes(record["sentiment"] as string)) {
      problems.push("sentiment: must be positive, negative or neutral");
    }
    if (typeof record["score"] !== "number" || record["score"] < 0 || record["score"] > 1) {
      problems.push("score: must be a number between 0 and 1");
    }
    return problems.length === 0
      ? { ok: true, value: record as unknown as Sentiment }
      : { ok: false, problems };
  },
);

// Real providers would be createAnthropicProvider() etc. Mocks keep the example
// runnable with no key and no network.
const router = createRouter({
  providers: {
    primary: createMockProvider("primary", [{ fail: "rate_limit", message: "429 from the primary" }]),
    backup: createMockProvider("backup", [
      { text: 'Sure! ```json\n{"sentiment":"elated","score":7}\n```' }, // wrong enum, out of range
      { text: '{"sentiment":"positive","score":0.91}' },                // after being told why
    ]),
  },
  chain: [
    withPricing({ ...models.anthropic.opus5, provider: "primary" }, { inputPerMTok: 15, outputPerMTok: 75 }),
    withPricing({ ...models.anthropic.haiku45, provider: "backup" }, { inputPerMTok: 1, outputPerMTok: 5 }),
  ],
});

const result = await router.complete({
  prompt: "Classify the sentiment of: 'the food was genuinely wonderful'",
  contract,
});

if (!result.ok) {
  console.error("failed:", result.error.message);
  process.exit(1);
}

console.log("answer   :", result.data);
console.log("served by:", result.meta.servedBy, `(${result.meta.tier})`);
console.log("degraded :", result.meta.degraded);
console.log("repairs  :", result.meta.repairs);
console.log("cost     : $" + result.meta.costUsd.toFixed(6));
console.log("\nattempts:");
for (const attempt of result.meta.attempts) {
  const detail =
    attempt.outcome === "ok"
      ? "accepted"
      : `${attempt.failure}${attempt.problems ? ` — ${attempt.problems.join("; ")}` : ""}`;
  console.log(`  ${attempt.model} (${attempt.tier}) repair=${attempt.repair}: ${detail}`);
}
