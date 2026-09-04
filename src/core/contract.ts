import type { Contract, ContractResult } from "./types.js";

/** Anything with a zod-shaped `safeParse`. Satisfied by zod 3, zod 4 and valibot. */
export interface SafeParser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
}

/**
 * Adapts any `safeParse`-shaped validator to a Contract.
 *
 * Structural rather than a dependency on zod, so this library works with zod 3
 * and zod 4 — which are not source compatible — and with validators that are
 * neither. The JSON Schema is supplied explicitly because a library that
 * derived it would need to know which validator it was given.
 */
export function fromSafeParser<T>(
  name: string,
  schema: unknown,
  parser: SafeParser<T>,
): Contract<T> {
  return {
    name,
    schema,
    validate(value: unknown): ContractResult<T> {
      const result = parser.safeParse(value);
      return result.success
        ? { ok: true, value: result.data }
        : { ok: false, problems: describeProblems(result.error) };
    },
  };
}

/** Builds a Contract from a plain predicate, for callers with no validator. */
export function defineContract<T>(
  name: string,
  schema: unknown,
  validate: (value: unknown) => ContractResult<T>,
): Contract<T> {
  return { name, schema, validate };
}

/**
 * Turns a validator's error into lines a model can act on.
 *
 * Zod-shaped issues become "path: message", which is what makes a repair
 * attempt worth making — "invalid input" tells the model nothing.
 */
function describeProblems(error: unknown): string[] {
  if (error !== null && typeof error === "object" && "issues" in error) {
    const { issues } = error;
    if (Array.isArray(issues)) {
      const described = issues.map((issue: unknown) => {
        if (issue === null || typeof issue !== "object") return String(issue);
        const record = issue as Record<string, unknown>;
        const path = Array.isArray(record["path"]) ? record["path"].join(".") : "";
        const message = typeof record["message"] === "string" ? record["message"] : "invalid";
        return path === "" ? message : `${path}: ${message}`;
      });
      if (described.length > 0) return described;
    }
  }
  if (error instanceof Error) return [error.message];
  return [String(error)];
}
