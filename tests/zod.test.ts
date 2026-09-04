import { describe, expect, it } from "vitest";
import { z } from "zod";

import { fromSafeParser } from "../src/core/contract.js";
import { createRouter } from "../src/core/router.js";
import { createMockProvider } from "../src/testing/mock.js";
import { model } from "./helpers.js";

/**
 * The README's usage block, exercised.
 *
 * zod is a devDependency only — the library never imports it. This proves the
 * structural Contract really does accept real zod, and that the JSON Schema
 * helper the README tells people to use exists and produces something the
 * calibration layer can put in a prompt.
 */
const Sentiment = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  score: z.number().min(0).max(1),
});

const contract = fromSafeParser("sentiment", z.toJSONSchema(Sentiment), Sentiment);

describe("with real zod", () => {
  it("generates a JSON Schema the prompt can carry", () => {
    const schema = contract.schema as Record<string, unknown>;
    expect(schema["type"]).toBe("object");
    expect(JSON.stringify(schema)).toContain("sentiment");
  });

  it("accepts a valid value and types it", () => {
    const result = contract.validate({ sentiment: "positive", score: 0.9 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sentiment).toBe("positive");
  });

  it("turns zod issues into per-field lines a model can act on", () => {
    const result = contract.validate({ sentiment: "elated", score: 7 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toHaveLength(2);
    expect(result.problems.join("\n")).toContain("sentiment:");
    expect(result.problems.join("\n")).toContain("score:");
  });

  it("drives a full repair cycle end to end", async () => {
    const provider = createMockProvider("mock", [
      { text: '{"sentiment":"elated","score":7}' },
      { text: '{"sentiment":"positive","score":0.9}' },
    ]);
    const router = createRouter({
      providers: { mock: provider },
      chain: [model("primary", "compact")],
    });

    const result = await router.complete({ prompt: "classify", contract });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.score).toBe(0.9);
    // the repair prompt carried zod's own messages, not a generic failure
    expect(provider.calls[1]?.prompt).toContain("sentiment:");
  });
});
