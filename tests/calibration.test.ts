import { describe, expect, it } from "vitest";

import { buildRepairPrompt, buildSystemPrompt, defaultCalibration, exampleFromSchema } from "../src/core/calibration.js";
import { createRouter } from "../src/core/router.js";
import { createMockProvider } from "../src/testing/mock.js";
import { VALID, model, sentimentContract, sentimentSchema } from "./helpers.js";

describe("tiers produce different requests", () => {
  const systemFor = (tier: "frontier" | "balanced" | "compact") =>
    buildSystemPrompt(sentimentContract, defaultCalibration[tier]);

  it("gives every tier the schema", () => {
    for (const tier of ["frontier", "balanced", "compact"] as const) {
      expect(systemFor(tier)).toContain('"sentiment"');
    }
  });

  it("only scaffolds the models that need it", () => {
    // The claim the library rests on: a frontier model is not given the
    // hand-holding a compact one needs, because it makes frontier output worse.
    expect(systemFor("frontier")).not.toContain("Do not wrap the JSON");
    expect(systemFor("balanced")).toContain("Do not wrap the JSON");
    expect(systemFor("compact")).toContain("Do not wrap the JSON");
  });

  it("only gives a worked example to the weakest tier", () => {
    expect(systemFor("frontier")).not.toContain("Copy the structure");
    expect(systemFor("balanced")).not.toContain("Copy the structure");
    expect(systemFor("compact")).toContain("Copy the structure");
  });

  it("lowers temperature as capability drops", () => {
    expect(defaultCalibration.frontier.temperature)
      .toBeGreaterThan(defaultCalibration.balanced.temperature);
    expect(defaultCalibration.balanced.temperature)
      .toBeGreaterThan(defaultCalibration.compact.temperature);
  });

  it("sends the tier's temperature to the provider", async () => {
    const provider = createMockProvider("mock", [{ text: VALID }]);
    await createRouter({
      providers: { mock: provider },
      chain: [model("m", "compact")],
    }).complete({ prompt: "x", contract: sentimentContract });

    expect(provider.calls[0]?.temperature).toBe(0);
  });

  it("lets a caller override one tier without redefining the rest", async () => {
    const provider = createMockProvider("mock", [{ text: VALID }]);
    await createRouter({
      providers: { mock: provider },
      chain: [model("m", "compact")],
      calibration: { compact: { temperature: 0.7 } },
    }).complete({ prompt: "x", contract: sentimentContract });

    expect(provider.calls[0]?.temperature).toBe(0.7);
    // the untouched knobs still apply
    expect(provider.calls[0]?.system).toContain("Copy the structure");
  });
});

describe("the worked example", () => {
  it("matches the schema it was generated from", () => {
    const example = exampleFromSchema(sentimentSchema);
    // Generated examples must satisfy the contract, or they teach a weak model
    // the wrong shape — which is worse than giving it no example.
    expect(sentimentContract.validate(example).ok).toBe(true);
  });

  it.each([
    ["string", { type: "string" }, "text"],
    ["integer", { type: "integer" }, 1],
    ["number", { type: "number" }, 0.5],
    ["boolean", { type: "boolean" }, true],
    ["null", { type: "null" }, null],
    ["enum", { type: "string", enum: ["a", "b"] }, "a"],
    ["const", { const: 42 }, 42],
    ["minimum wins over the default", { type: "integer", minimum: 7 }, 7],
    ["date-time format", { type: "string", format: "date-time" }, "2026-01-01T00:00:00Z"],
    ["email format", { type: "string", format: "email" }, "name@example.com"],
  ])("renders %s", (_name, schema, expected) => {
    expect(exampleFromSchema(schema)).toEqual(expected);
  });

  it("nests objects and arrays", () => {
    expect(
      exampleFromSchema({
        type: "object",
        properties: { tags: { type: "array", items: { type: "string" } } },
        required: ["tags"],
      }),
    ).toEqual({ tags: ["text"] });
  });

  it("omits optional fields so the example does not imply they are required", () => {
    expect(
      exampleFromSchema({
        type: "object",
        properties: { a: { type: "string" }, b: { type: "string" } },
        required: ["a"],
      }),
    ).toEqual({ a: "text" });
  });

  it("gives up rather than guessing at a shape it does not understand", () => {
    expect(exampleFromSchema({ type: "wat" })).toBeUndefined();
    expect(exampleFromSchema(null)).toBeUndefined();
    expect(exampleFromSchema("not a schema")).toBeUndefined();
  });

  it("stops recursing on a self-referential schema", () => {
    const recursive: Record<string, unknown> = { type: "object" };
    recursive["properties"] = { self: recursive };
    recursive["required"] = ["self"];
    // must terminate rather than blow the stack
    expect(() => exampleFromSchema(recursive)).not.toThrow();
  });
});

describe("the repair prompt", () => {
  it("carries the original ask, the bad answer and the specific problems", () => {
    const prompt = buildRepairPrompt("Classify this", '{"sentiment":"elated"}', ["sentiment: not allowed"]);

    expect(prompt).toContain("Classify this");
    expect(prompt).toContain("elated");
    expect(prompt).toContain("sentiment: not allowed");
  });

  it("truncates a runaway answer instead of echoing it whole", () => {
    const huge = "x".repeat(10_000);
    expect(buildRepairPrompt("ask", huge, ["nope"]).length).toBeLessThan(3000);
  });
});
