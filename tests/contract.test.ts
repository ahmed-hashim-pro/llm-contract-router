import { describe, expect, it } from "vitest";

import { fromSafeParser } from "../src/core/contract.js";
import { models, withPricing, defineModel } from "../src/core/models.js";
import { createMockProvider } from "../src/testing/mock.js";

/** A stand-in for zod, proving the structural interface is all that is needed. */
const zodLike = {
  safeParse(value: unknown) {
    if (typeof value === "object" && value !== null && "n" in value && typeof value.n === "number") {
      return { success: true as const, data: value as { n: number } };
    }
    return {
      success: false as const,
      error: { issues: [{ path: ["n"], message: "Expected number, received string" }] },
    };
  },
};

describe("fromSafeParser", () => {
  it("accepts a value the parser accepts", () => {
    const contract = fromSafeParser("num", { type: "object" }, zodLike);
    expect(contract.validate({ n: 1 })).toEqual({ ok: true, value: { n: 1 } });
  });

  it("turns zod-shaped issues into lines a model can act on", () => {
    const contract = fromSafeParser("num", { type: "object" }, zodLike);
    const result = contract.validate({ n: "x" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // "path: message" is what makes a repair worth attempting; "invalid input"
    // tells the model nothing.
    expect(result.problems).toEqual(["n: Expected number, received string"]);
  });

  it("copes with a validator that throws a plain Error", () => {
    const contract = fromSafeParser("num", {}, {
      safeParse: () => ({ success: false as const, error: new Error("nope") }),
    });
    const result = contract.validate({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems).toEqual(["nope"]);
  });

  it("copes with a validator whose error is not an object at all", () => {
    const contract = fromSafeParser("num", {}, {
      safeParse: () => ({ success: false as const, error: "just a string" }),
    });
    const result = contract.validate({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems).toEqual(["just a string"]);
  });
});

describe("the model registry", () => {
  it("ships identities and tiers but no prices", () => {
    // Prices go stale between releases; a wrong number that looks authoritative
    // is worse than no number.
    expect(models.anthropic.opus5).not.toHaveProperty("inputPerMTok");
    expect(models.anthropic.opus5.tier).toBe("frontier");
    expect(models.anthropic.haiku45.tier).toBe("compact");
  });

  it("becomes routable once the caller supplies current pricing", () => {
    const spec = withPricing(models.anthropic.opus5, { inputPerMTok: 1, outputPerMTok: 2 });
    expect(spec.id).toBe("claude-opus-5");
    expect(spec.inputPerMTok).toBe(1);
  });

  it("refuses negative pricing", () => {
    expect(() => withPricing(models.anthropic.opus5, { inputPerMTok: -1, outputPerMTok: 0 }))
      .toThrow(/cannot be negative/);
  });

  it("defines a model it has never heard of", () => {
    const spec = defineModel(
      { id: "some-new-model", provider: "custom", tier: "balanced" },
      { inputPerMTok: 3, outputPerMTok: 6 },
    );
    expect(spec.tier).toBe("balanced");
  });
});

describe("the mock provider", () => {
  it("records what the router asked it", async () => {
    const provider = createMockProvider("m", [{ text: "{}" }]);
    await provider.complete({
      model: "x", system: "sys", prompt: "hi", temperature: 0, maxOutputTokens: 10,
    });
    expect(provider.calls[0]?.prompt).toBe("hi");
  });

  it("repeats its last turn so a script need not be padded", async () => {
    const provider = createMockProvider("m", [{ text: "once" }]);
    const first = await provider.complete({ model: "x", system: "", prompt: "", temperature: 0, maxOutputTokens: 1 });
    const second = await provider.complete({ model: "x", system: "", prompt: "", temperature: 0, maxOutputTokens: 1 });
    expect(first.text).toBe(second.text);
    expect(provider.remaining).toBe(0);
  });

  it("runs a function turn so a test can answer based on the request", async () => {
    const provider = createMockProvider("m", [
      (request) => ({ text: request.prompt.toUpperCase(), usage: { inputTokens: 1, outputTokens: 1 } }),
    ]);
    const response = await provider.complete({
      model: "x", system: "", prompt: "hi", temperature: 0, maxOutputTokens: 1,
    });
    expect(response.text).toBe("HI");
  });

  it("refuses an empty script", () => {
    expect(() => createMockProvider("m", [])).toThrow(/at least one/);
  });
});
