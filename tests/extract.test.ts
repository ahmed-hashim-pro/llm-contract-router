import { describe, expect, it } from "vitest";

import { extractJson } from "../src/core/extract.js";

describe("extractJson", () => {
  it.each([
    ["bare object", '{"a":1}', { a: 1 }],
    ["bare array", "[1,2]", [1, 2]],
    ["leading and trailing whitespace", '  \n {"a":1}\n  ', { a: 1 }],
    ["json fence", '```json\n{"a":1}\n```', { a: 1 }],
    ["bare fence", '```\n{"a":1}\n```', { a: 1 }],
    ["uppercase fence", '```JSON\n{"a":1}\n```', { a: 1 }],
    ["prose before", 'Here you go:\n{"a":1}', { a: 1 }],
    ["prose after", '{"a":1}\nHope that helps!', { a: 1 }],
    ["prose both sides", 'Sure!\n{"a":1}\nLet me know.', { a: 1 }],
    ["nested braces", '{"a":{"b":{"c":1}}}', { a: { b: { c: 1 } } }],
  ])("reads %s", (_name, input, expected) => {
    const result = extractJson(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(expected);
  });

  // A regex cannot do this: the first closing brace is inside a string.
  it("is not fooled by a brace inside a string literal", () => {
    const result = extractJson('Here: {"note":"}"} done');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ note: "}" });
  });

  it("is not fooled by an escaped quote", () => {
    const result = extractJson('prose {"note":"say \\"hi\\" }"} more');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ note: 'say "hi" }' });
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "   \n "],
    ["prose with no JSON", "I am not able to help with that."],
    ["unterminated object", '{"a":'],
  ])("refuses %s", (_name, input) => {
    expect(extractJson(input).ok).toBe(false);
  });

  it("explains why it could not read the answer", () => {
    const result = extractJson("sorry, no");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toMatch(/parseable JSON/);
  });
});
