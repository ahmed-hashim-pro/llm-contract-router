/**
 * Pulls a JSON value out of whatever the model actually said.
 *
 * Instructing a model to return only JSON does not make it so, and the weaker
 * the model the less it holds. Being tolerant here is what keeps a compact
 * model from failing the contract over a markdown fence.
 */
export function extractJson(text: string): { ok: true; value: unknown } | { ok: false; problem: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, problem: "the model returned an empty response" };

  for (const candidate of candidates(trimmed)) {
    try {
      return { ok: true, value: JSON.parse(candidate) as unknown };
    } catch {
      continue;
    }
  }
  return {
    ok: false,
    problem: "the response did not contain a parseable JSON value",
  };
}

/** Ordered most to least likely, so the cheapest interpretation wins. */
function* candidates(text: string): Generator<string> {
  yield text;

  const fenced = text.match(/```(?:json|JSON)?\s*\n([\s\S]*?)```/);
  if (fenced?.[1] !== undefined) yield fenced[1].trim();

  const object = balancedSpan(text, "{", "}");
  if (object !== null) yield object;

  const array = balancedSpan(text, "[", "]");
  if (array !== null) yield array;
}

/**
 * Finds the first balanced span, ignoring braces inside string literals.
 *
 * A regex cannot do this: `{"note": "}"}` is valid JSON whose first closing
 * brace is inside a string.
 */
function balancedSpan(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === open) depth++;
    else if (char === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
