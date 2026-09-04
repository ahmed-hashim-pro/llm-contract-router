import { describe, expect, it } from "vitest";

import { createRouter } from "../src/core/router.js";
import { createHangingProvider, createMockProvider } from "../src/testing/mock.js";
import { INVALID, VALID, model, sentimentContract } from "./helpers.js";

const ask = { prompt: "Classify: the food was great", contract: sentimentContract };

describe("the happy path", () => {
  it("returns validated data from the first model", async () => {
    const primary = createMockProvider("mock", [{ text: VALID }]);
    const router = createRouter({
      providers: { mock: primary },
      chain: [model("primary", "frontier")],
    });

    const result = await router.complete(ask);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ sentiment: "positive", score: 0.9 });
    expect(result.meta.servedBy).toBe("primary");
    expect(result.meta.degraded).toBe(false);
    expect(result.meta.repairs).toBe(0);
  });

  it("prices the call from the model's own rates", async () => {
    const router = createRouter({
      providers: { mock: createMockProvider("mock", [{ text: VALID, usage: { inputTokens: 1000, outputTokens: 500 } }]) },
      chain: [model("primary", "frontier")],
    });

    const result = await router.complete(ask);
    // 1000/1e6 * $5 + 500/1e6 * $10 = $0.005 + $0.005
    expect(result.meta.costUsd).toBeCloseTo(0.01, 10);
  });
});

describe("falling over", () => {
  it.each([
    ["rate_limit"],
    ["unavailable"],
    ["auth"],
    ["invalid_request"],
  ] as const)("moves to the next model on %s", async (failure) => {
    const router = createRouter({
      providers: {
        a: createMockProvider("a", [{ fail: failure }]),
        b: createMockProvider("b", [{ text: VALID }]),
      },
      chain: [model("primary", "frontier", "a"), model("backup", "compact", "b")],
    });

    const result = await router.complete(ask);

    expect(result.ok).toBe(true);
    expect(result.meta.servedBy).toBe("backup");
    expect(result.meta.degraded).toBe(true);
    expect(result.meta.attempts[0]?.failure).toBe(failure);
  });

  it("does not retry a model that failed at the provider level", async () => {
    const primary = createMockProvider("a", [{ fail: "rate_limit" }]);
    const router = createRouter({
      providers: { a: primary, b: createMockProvider("b", [{ text: VALID }]) },
      chain: [model("primary", "frontier", "a"), model("backup", "compact", "b")],
      repairsPerModel: 2,
    });

    await router.complete(ask);

    // A repair fixes a bad answer. It cannot fix a 429.
    expect(primary.calls).toHaveLength(1);
  });

  it("reports every model it tried when the chain runs out", async () => {
    const router = createRouter({
      providers: {
        a: createMockProvider("a", [{ fail: "unavailable" }]),
        b: createMockProvider("b", [{ fail: "rate_limit" }]),
      },
      chain: [model("primary", "frontier", "a"), model("backup", "compact", "b")],
    });

    const result = await router.complete(ask);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("chain_exhausted");
    // meta is most valuable exactly here
    expect(result.meta.attempts).toHaveLength(2);
    expect(result.meta.attempts.map((a) => a.failure)).toEqual(["unavailable", "rate_limit"]);
  });

  it("skips a model whose provider was never registered without losing the rest", async () => {
    const router = createRouter({
      providers: { b: createMockProvider("b", [{ text: VALID }]) },
      chain: [model("primary", "frontier", "missing"), model("backup", "compact", "b")],
    });

    const result = await router.complete(ask);

    expect(result.ok).toBe(true);
    expect(result.meta.servedBy).toBe("backup");
  });

  it("treats a provider that never answers as a timeout", async () => {
    const router = createRouter({
      providers: { slow: createHangingProvider("slow"), b: createMockProvider("b", [{ text: VALID }]) },
      chain: [model("primary", "frontier", "slow"), model("backup", "compact", "b")],
      timeoutMs: 20,
    });

    const result = await router.complete(ask);

    expect(result.ok).toBe(true);
    expect(result.meta.attempts[0]?.failure).toBe("timeout");
  });
});

describe("the contract", () => {
  it("repairs a malformed answer instead of giving up", async () => {
    const provider = createMockProvider("mock", [{ text: INVALID }, { text: VALID }]);
    const router = createRouter({
      providers: { mock: provider },
      chain: [model("primary", "compact")],
    });

    const result = await router.complete(ask);

    expect(result.ok).toBe(true);
    expect(result.meta.repairs).toBe(1);
    expect(provider.calls).toHaveLength(2);
  });

  it("tells the model what was wrong, not just that it was wrong", async () => {
    const provider = createMockProvider("mock", [{ text: INVALID }, { text: VALID }]);
    const router = createRouter({
      providers: { mock: provider },
      chain: [model("primary", "compact")],
    });

    await router.complete(ask);

    const repairPrompt = provider.calls[1]?.prompt ?? "";
    expect(repairPrompt).toContain("score: must be a number between 0 and 1");
    expect(repairPrompt).toContain("sentiment: must be one of");
    // it must also show the model what it actually produced
    expect(repairPrompt).toContain("elated");
  });

  it("falls to the next model when repair does not help", async () => {
    const router = createRouter({
      providers: {
        a: createMockProvider("a", [{ text: INVALID }]), // repeats forever
        b: createMockProvider("b", [{ text: VALID }]),
      },
      chain: [model("primary", "frontier", "a"), model("backup", "compact", "b")],
    });

    const result = await router.complete(ask);

    expect(result.ok).toBe(true);
    expect(result.meta.servedBy).toBe("backup");
    // one initial attempt plus one repair on the primary, then the backup
    expect(result.meta.attempts).toHaveLength(3);
  });

  it("honours repairsPerModel: 0", async () => {
    const provider = createMockProvider("mock", [{ text: INVALID }]);
    const router = createRouter({
      providers: { mock: provider },
      chain: [model("primary", "frontier")],
      repairsPerModel: 0,
    });

    const result = await router.complete(ask);

    expect(result.ok).toBe(false);
    expect(provider.calls).toHaveLength(1);
  });

  it("accepts an answer wrapped in a markdown fence", async () => {
    const router = createRouter({
      providers: { mock: createMockProvider("mock", [{ text: "Sure!\n```json\n" + VALID + "\n```" }]) },
      chain: [model("primary", "compact")],
    });

    const result = await router.complete(ask);
    expect(result.ok).toBe(true);
  });
});

describe("cost control", () => {
  it("stops rather than spending past the budget", async () => {
    const router = createRouter({
      providers: {
        a: createMockProvider("a", [{ text: INVALID, usage: { inputTokens: 1_000_000, outputTokens: 0 } }]),
        b: createMockProvider("b", [{ text: VALID }]),
      },
      chain: [model("primary", "frontier", "a"), model("backup", "compact", "b")],
      maxCostUsd: 1,
    });

    const result = await router.complete(ask);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // the first attempt alone costs $5, so no repair and no fallback is tried
    expect(result.error.kind).toBe("budget_exceeded");
    expect(result.meta.attempts).toHaveLength(1);
  });

  it("counts every attempt, so a degraded path can cost more than the primary", async () => {
    const router = createRouter({
      providers: {
        a: createMockProvider("a", [{ text: INVALID }]),
        b: createMockProvider("b", [{ text: VALID }]),
      },
      chain: [model("primary", "frontier", "a"), model("backup", "compact", "b")],
    });

    const result = await router.complete(ask);

    const summed = result.meta.attempts.reduce((total, a) => total + a.costUsd, 0);
    expect(result.meta.costUsd).toBeCloseTo(summed, 12);
    expect(result.meta.attempts).toHaveLength(3);
  });
});

describe("configuration", () => {
  it("refuses an empty chain before sending anything", async () => {
    const router = createRouter({ providers: { mock: createMockProvider("mock", [{ text: VALID }]) }, chain: [] });
    const result = await router.complete(ask);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("configuration");
  });

  it("refuses when no providers are registered", async () => {
    const result = await createRouter({ providers: {}, chain: [model("a", "frontier")] }).complete(ask);
    expect(result.ok).toBe(false);
  });

  it("refuses a negative repair count", async () => {
    const result = await createRouter({
      providers: { mock: createMockProvider("mock", [{ text: VALID }]) },
      chain: [model("a", "frontier")],
      repairsPerModel: -1,
    }).complete(ask);
    expect(result.ok).toBe(false);
  });
});
