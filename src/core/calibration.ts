import type { Contract, Tier } from "./types.js";

/**
 * How a request is shaped for a given tier.
 *
 * These are the knobs that make degradation predictable. A weaker model needs
 * the schema restated, an example to copy, and no room to be creative; a
 * frontier model given all that produces worse output, because the scaffolding
 * crowds out the actual task.
 */
export interface TierCalibration {
  readonly temperature: number;
  /** Restate the schema in the prompt rather than relying on the model to recall it. */
  readonly restateSchema: boolean;
  /** Include a filled-in example generated from the schema. */
  readonly includeExample: boolean;
  /** Spell out the rules that a stronger model infers. */
  readonly explicitRules: boolean;
}

export const defaultCalibration: Readonly<Record<Tier, TierCalibration>> = {
  frontier: {
    temperature: 0.2,
    restateSchema: true,
    includeExample: false,
    explicitRules: false,
  },
  balanced: {
    temperature: 0.1,
    restateSchema: true,
    includeExample: false,
    explicitRules: true,
  },
  compact: {
    temperature: 0,
    restateSchema: true,
    includeExample: true,
    explicitRules: true,
  },
};

const RULES = [
  "Return only the JSON object. No prose before or after it.",
  "Do not wrap the JSON in markdown code fences.",
  "Include every required field. Do not invent fields that are not in the schema.",
  "If a value is genuinely unknown, use the schema's allowed representation for it rather than omitting the field.",
];

/** Builds the system prompt for one attempt. */
export function buildSystemPrompt(
  contract: Contract<unknown>,
  calibration: TierCalibration,
): string {
  const parts: string[] = [
    `You produce a single JSON value conforming to the "${contract.name}" schema.`,
  ];

  if (calibration.restateSchema) {
    parts.push(`JSON Schema:\n${JSON.stringify(contract.schema, null, 2)}`);
  }
  if (calibration.explicitRules) {
    parts.push(RULES.map((rule) => `- ${rule}`).join("\n"));
  }
  if (calibration.includeExample) {
    const example = exampleFromSchema(contract.schema);
    if (example !== undefined) {
      parts.push(
        `An example of the required shape. Copy the structure, not the values:\n${JSON.stringify(example, null, 2)}`,
      );
    }
  }
  return parts.join("\n\n");
}

/**
 * Builds the follow-up prompt after a contract failure.
 *
 * The model is told what it produced and exactly which constraints it broke.
 * Asking again without that just re-rolls the same mistake.
 */
export function buildRepairPrompt(
  originalPrompt: string,
  produced: string,
  problems: readonly string[],
): string {
  return [
    originalPrompt,
    "",
    "Your previous answer did not satisfy the schema.",
    "",
    "You produced:",
    produced.slice(0, 2000),
    "",
    "These constraints were not met:",
    ...problems.map((problem) => `- ${problem}`),
    "",
    "Return corrected JSON only.",
  ].join("\n");
}

/**
 * Produces a filled-in instance of a JSON Schema, for use as an example.
 *
 * It handles the subset of JSON Schema that describes a tool's output shape and
 * returns undefined for anything it does not recognise — an example that does
 * not match the schema would teach a weak model the wrong shape, which is worse
 * than giving it none.
 */
export function exampleFromSchema(schema: unknown, depth = 0): unknown {
  if (depth > 6 || typeof schema !== "object" || schema === null) return undefined;
  const node = schema as Record<string, unknown>;

  if (Array.isArray(node["enum"]) && node["enum"].length > 0) return node["enum"][0];
  if (node["const"] !== undefined) return node["const"];

  const declared: unknown = node["type"];
  const type: unknown = Array.isArray(declared) ? declared[0] : declared;
  switch (type) {
    case "object": {
      const properties = node["properties"];
      if (typeof properties !== "object" || properties === null) return {};
      const required = Array.isArray(node["required"])
        ? new Set(node["required"] as string[])
        : null;
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(properties as Record<string, unknown>)) {
        // Optional fields are omitted so the example does not imply they are
        // required, unless nothing is marked required at all.
        if (required && !required.has(key)) continue;
        const value = exampleFromSchema(child, depth + 1);
        if (value !== undefined) out[key] = value;
      }
      return out;
    }
    case "array": {
      const item = exampleFromSchema(node["items"], depth + 1);
      return item === undefined ? [] : [item];
    }
    case "string":
      return typeof node["format"] === "string" ? formatExample(node["format"]) : "text";
    case "integer":
      return numericExample(node, true);
    case "number":
      return numericExample(node, false);
    case "boolean":
      return true;
    case "null":
      return null;
    default:
      return undefined;
  }
}

function numericExample(node: Record<string, unknown>, integer: boolean): number {
  const minimum = node["minimum"];
  if (typeof minimum === "number") return minimum;
  return integer ? 1 : 0.5;
}

function formatExample(format: string): string {
  switch (format) {
    case "date-time":
      return "2026-01-01T00:00:00Z";
    case "date":
      return "2026-01-01";
    case "email":
      return "name@example.com";
    case "uri":
    case "url":
      return "https://example.com";
    case "uuid":
      return "00000000-0000-0000-0000-000000000000";
    default:
      return "text";
  }
}
