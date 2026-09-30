import { Intent } from "../intents/intent.js";

/** A function is its name; an intent its own description; anything else is JSON's business. */
function describeValue(value: unknown): string | undefined {
  if (typeof value === "function") return value.name || "(anonymous)";
  if (Intent.isIntent(value)) return value.describe();
  return undefined;
}

/**
 * `${expr}` in any instruction literal and every value of a context statement
 * (spec 2026-09-28 §3.3, 2026-09-29 §3.4): a string verbatim, a function its
 * name, an intent its description, anything else JSON — the same two rules
 * inside arrays and objects — and `undefined` spelled as JavaScript spells it.
 * Deterministic — the text is fingerprint input. The one formatter: a call
 * intent describes its own arguments with it (`FunctionCallIntent.describe`),
 * so a slot nested in an object argument renders as its prompt, never as the
 * intent's internals.
 */
export function fmt(value: unknown): string {
  if (typeof value === "string") return value;
  const described = describeValue(value);
  if (described !== undefined) return described;
  return JSON.stringify(value, (_key, v: unknown) => describeValue(v) ?? v) ?? String(value);
}
