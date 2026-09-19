import { type Askable, NolaResolutionError, Site } from "@nola-lang/core";
import type { AskLocals } from "../infer-context/index.js";
import { Intent } from "../intents/intent.js";
import { runInvocation } from "../intents/invocation/lifecycle.js";
import { ModuleContext } from "../intents/invocation/module-context.js";
import type { Frame } from "../runtime/index.js";

/**
 * `ask expr` — validate the operand is an Intent and run it against the asking
 * scope's frame. Context chains here: this is the only place a parent frame
 * reaches an intent. Inside an infer body the scope IS the frame; the module
 * body has no wrapper to mint one, so it passes its scope node and a
 * `<module>` root is opened here — one per ask, with the asked intent's own
 * timeout as its clock (at module level the ask is the root; whether asks
 * share one module frame is this function's decision, never the emitted
 * text's). `model` is the `ask with <name>` alias; being the ask-site choice
 * it overrides an intent's own .withModel pin (forceModel still beats both —
 * resolveModel owns that precedence).
 */
export async function ask<T>(
  value: Askable<T>,
  scope: Frame | ModuleContext,
  model?: string,
  locals?: AskLocals,
): Promise<T> {
  if (scope instanceof ModuleContext) {
    const timeout = Intent.isIntent(value) ? value.timeout : undefined;
    const root = scope.runtime.openFrame(scope, timeout === undefined ? {} : { timeout });
    return runInvocation(root, (frame) => ask(value, frame, model, locals));
  }
  const frame = scope;
  if (!Intent.isIntent(value)) {
    throw new NolaResolutionError("ask operand is not an Intent", {
      prompt: "<not an intent>",
      raw: "",
      site: new Site(frame.sourceFile(), "?"),
    });
  }
  let intent = value as unknown as Intent<T>;
  if (model !== undefined) intent = intent.withModel(model);
  if (locals !== undefined) intent = intent.withLocals(locals);
  return intent.run(frame);
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
