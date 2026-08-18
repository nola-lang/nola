import { type Askable, NolaResolutionError, Site } from "@nola-lang/core";
import { Intent } from "../intents/intent.js";
import type { Frame } from "../runtime/index.js";

/**
 * `ask expr` — validate the operand is an Intent and run it against the asking
 * function's frame. Context chains here: this is the only place a parent frame
 * reaches an intent. `provider` is the `ask with <name>` alias; being the
 * ask-site choice it overrides an intent's own .withProvider pin (forceProvider
 * still beats both — resolveProvider owns that precedence).
 */
export async function ask<T>(value: Askable<T>, frame: Frame, provider?: string): Promise<T> {
  if (!Intent.isIntent(value)) {
    throw new NolaResolutionError("ask operand is not an Intent", {
      prompt: "<not an intent>",
      raw: "",
      site: new Site(frame.sourceFile(), "?"),
    });
  }
  const intent = value as unknown as Intent<T>;
  return (provider === undefined ? intent : intent.withProvider(provider)).run(frame);
}

/** `${expr}` prompt splice: strings verbatim, everything else JSON. */
export function fmt(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? String(value);
}

/** One interpolated value of a prompt template (see tpl). */
function tplValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(tplValue).join("\n");
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value) ?? "";
  return String(value);
}

/**
 * The tag lowered prompt templates render through: strings as-is, arrays
 * joined with newlines (so `.map(...)` needs no `.join`), undefined/null as
 * nothing, Date as ISO, other objects as JSON. Deterministic — the rendered
 * text is fingerprint input.
 */
export function tpl(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) out += tplValue(values[i]) + (strings[i + 1] ?? "");
  return out;
}
