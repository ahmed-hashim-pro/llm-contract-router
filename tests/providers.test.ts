import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { describe, expect, it } from "vitest";

import { createAnthropicProvider } from "../src/providers/anthropic.js";
import { createOpenAIProvider } from "../src/providers/openai.js";
import { classifyStatus, resolveApiKey } from "../src/providers/shared.js";
import { ProviderError } from "../src/core/types.js";

const request = {
  model: "m", system: "be terse", prompt: "hello", temperature: 0.3, maxOutputTokens: 256,
};

describe("classifyStatus", () => {
  it.each([
    [401, "auth"], [403, "auth"], [408, "timeout"], [429, "rate_limit"],
    [400, "invalid_request"], [404, "invalid_request"], [422, "invalid_request"],
    [500, "unavailable"], [503, "unavailable"],
    [undefined, "unknown"], [200, "unknown"],
  ] as const)("maps %s to %s", (status, expected) => {
    expect(classifyStatus(status)).toBe(expected);
  });
});

describe("resolveApiKey", () => {
  it("prefers an explicit key", () => {
    expect(resolveApiKey("explicit", "NOPE_VAR", "p")).toBe("explicit");
  });

  it("falls back to the environment", () => {
    process.env["TEST_KEY_VAR"] = "from-env";
    try {
      expect(resolveApiKey(undefined, "TEST_KEY_VAR", "p")).toBe("from-env");
    } finally {
      delete process.env["TEST_KEY_VAR"];
    }
  });

  it("names both the option and the variable when there is no key", () => {
    // A missing key must fail here, loudly, rather than later as a 401.
    expect(() => resolveApiKey(undefined, "DEFINITELY_UNSET_VAR", "anthropic"))
      .toThrow(/anthropic.*apiKey.*DEFINITELY_UNSET_VAR/s);
  });

  it("treats a blank key as missing", () => {
    process.env["BLANK_KEY_VAR"] = "   ";
    try {
      expect(() => resolveApiKey(undefined, "BLANK_KEY_VAR", "p")).toThrow(/no API key/);
    } finally {
      delete process.env["BLANK_KEY_VAR"];
    }
  });
});

describe("the Anthropic adapter", () => {
  const fakeClient = (impl: () => unknown) =>
    ({ messages: { create: impl } }) as unknown as Anthropic;

  it("sends system as its own field, which is where Anthropic wants it", async () => {
    let seen: Record<string, unknown> = {};
    const provider = createAnthropicProvider({
      client: fakeClient(function (this: unknown, ...args: unknown[]) {
        seen = args[0] as Record<string, unknown>;
        return { content: [{ type: "text", text: "{}" }], usage: { input_tokens: 1, output_tokens: 2 } };
      }),
    });

    await provider.complete(request);

    expect(seen["system"]).toBe("be terse");
    expect(seen["max_tokens"]).toBe(256);
    expect(seen["messages"]).toEqual([{ role: "user", content: "hello" }]);
  });

  it("joins text blocks and ignores the rest", async () => {
    const provider = createAnthropicProvider({
      client: fakeClient(() => ({
        content: [
          { type: "text", text: "part one " },
          { type: "thinking", thinking: "ignore me" },
          { type: "text", text: "part two" },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
      })),
    });

    const response = await provider.complete(request);

    expect(response.text).toBe("part one part two");
    expect(response.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
  });

  it.each([
    [429, "rate_limit"], [401, "auth"], [500, "unavailable"], [400, "invalid_request"],
  ] as const)("classifies a %s as %s", async (status, kind) => {
    const provider = createAnthropicProvider({
      client: fakeClient(() => {
        throw new Anthropic.APIError(status, { error: { message: "boom" } }, "boom", undefined);
      }),
    });

    await expect(provider.complete(request)).rejects.toMatchObject({ kind });
  });

  it("classifies an unrecognised throw rather than leaking it", async () => {
    const provider = createAnthropicProvider({
      client: fakeClient(() => {
        throw new Error("socket exploded");
      }),
    });

    await expect(provider.complete(request)).rejects.toBeInstanceOf(ProviderError);
    await expect(provider.complete(request)).rejects.toMatchObject({ kind: "unknown" });
  });
});

describe("the OpenAI adapter", () => {
  const fakeClient = (impl: () => unknown) =>
    ({ chat: { completions: { create: impl } } }) as unknown as OpenAI;

  it("sends system as a message, which is where OpenAI wants it", async () => {
    let seen: Record<string, unknown> = {};
    const provider = createOpenAIProvider({
      client: fakeClient((...args: unknown[]) => {
        seen = args[0] as Record<string, unknown>;
        return { choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 1, completion_tokens: 2 } };
      }),
    });

    await provider.complete(request);

    // The same ProviderRequest becomes a different wire shape per vendor.
    // Reconciling that is the entire job of an adapter.
    expect(seen["messages"]).toEqual([
      { role: "system", content: "be terse" },
      { role: "user", content: "hello" },
    ]);
    expect(seen["max_completion_tokens"]).toBe(256);
  });

  it("survives a response with no content", async () => {
    const provider = createOpenAIProvider({
      client: fakeClient(() => ({ choices: [], usage: undefined })),
    });

    const response = await provider.complete(request);

    expect(response.text).toBe("");
    expect(response.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it.each([[429, "rate_limit"], [503, "unavailable"]] as const)(
    "classifies a %s as %s",
    async (status, kind) => {
      const provider = createOpenAIProvider({
        client: fakeClient(() => {
          throw new OpenAI.APIError(status, { message: "boom" }, "boom", undefined);
        }),
      });

      await expect(provider.complete(request)).rejects.toMatchObject({ kind });
    },
  );
});
