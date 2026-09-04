import Anthropic from "@anthropic-ai/sdk";

import type { Provider, ProviderRequest, ProviderResponse } from "../core/types.js";
import { ProviderError } from "../core/types.js";
import { classifyStatus, resolveApiKey } from "./shared.js";

export interface AnthropicProviderOptions {
  /** Falls back to ANTHROPIC_API_KEY. */
  readonly apiKey?: string;
  readonly baseURL?: string;
  /** Supply a preconfigured client instead, e.g. one with custom retries. */
  readonly client?: Anthropic;
  readonly name?: string;
}

export function createAnthropicProvider(options: AnthropicProviderOptions = {}): Provider {
  const name = options.name ?? "anthropic";
  const client =
    options.client ??
    new Anthropic({
      apiKey: resolveApiKey(options.apiKey, "ANTHROPIC_API_KEY", name),
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    });

  return {
    name,
    async complete(request: ProviderRequest): Promise<ProviderResponse> {
      try {
        const message = await client.messages.create(
          {
            model: request.model,
            max_tokens: request.maxOutputTokens,
            temperature: request.temperature,
            system: request.system,
            messages: [{ role: "user", content: request.prompt }],
          },
          request.signal ? { signal: request.signal } : {},
        );

        const text = message.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("");

        return {
          text,
          usage: {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
          },
        };
      } catch (error) {
        throw toProviderError(error, name);
      }
    },
  };
}

function toProviderError(error: unknown, provider: string): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof Anthropic.APIError) {
    // The SDK types `status` loosely; narrow it before classifying.
    const status = typeof error.status === "number" ? error.status : undefined;
    return new ProviderError(classifyStatus(status), provider, error.message, { cause: error });
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new ProviderError("timeout", provider, error.message, { cause: error });
  }
  return new ProviderError("unknown", provider, error instanceof Error ? error.message : String(error), {
    cause: error,
  });
}
