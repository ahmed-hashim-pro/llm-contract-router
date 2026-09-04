import OpenAI from "openai";

import type { Provider, ProviderRequest, ProviderResponse } from "../core/types.js";
import { ProviderError } from "../core/types.js";
import { classifyStatus, resolveApiKey } from "./shared.js";

export interface OpenAIProviderOptions {
  /** Falls back to OPENAI_API_KEY. */
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly client?: OpenAI;
  readonly name?: string;
}

export function createOpenAIProvider(options: OpenAIProviderOptions = {}): Provider {
  const name = options.name ?? "openai";
  const client =
    options.client ??
    new OpenAI({
      apiKey: resolveApiKey(options.apiKey, "OPENAI_API_KEY", name),
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    });

  return {
    name,
    async complete(request: ProviderRequest): Promise<ProviderResponse> {
      try {
        const completion = await client.chat.completions.create(
          {
            model: request.model,
            temperature: request.temperature,
            max_completion_tokens: request.maxOutputTokens,
            messages: [
              // Anthropic takes `system` as its own field; OpenAI takes it as a
              // message. Reconciling that is exactly what an adapter is for.
              { role: "system", content: request.system },
              { role: "user", content: request.prompt },
            ],
          },
          request.signal ? { signal: request.signal } : {},
        );

        return {
          text: completion.choices[0]?.message.content ?? "",
          usage: {
            inputTokens: completion.usage?.prompt_tokens ?? 0,
            outputTokens: completion.usage?.completion_tokens ?? 0,
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
  if (error instanceof OpenAI.APIError) {
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
