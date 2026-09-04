import type { FailureKind } from "../core/types.js";

/**
 * Maps an HTTP status to the only vocabulary the router understands.
 *
 * Classifying here rather than in the router is what keeps vendor differences
 * out of the routing logic: an adapter is the only place that knows what a 429
 * means for its provider.
 */
export function classifyStatus(status: number | undefined): FailureKind {
  if (status === undefined) return "unknown";
  if (status === 401 || status === 403) return "auth";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "unavailable";
  if (status >= 400) return "invalid_request";
  return "unknown";
}

/**
 * Resolves a key from the caller or the environment.
 *
 * BYOK, and the failure is loud: a missing key names the option and the
 * variable rather than surfacing later as a 401 from the provider.
 */
export function resolveApiKey(
  explicit: string | undefined,
  envVar: string,
  providerName: string,
): string {
  const key = explicit ?? process.env[envVar];
  if (key === undefined || key.trim() === "") {
    throw new Error(
      `${providerName}: no API key. Pass { apiKey } or set ${envVar}. ` +
        `The router never reads keys from anywhere else.`,
    );
  }
  return key;
}
