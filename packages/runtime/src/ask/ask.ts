import { type Askable, NolaResolutionError, Site } from "@nola-lang/core";
import type { VisibleContext } from "../infer-context/index.js";
import { Intent } from "../intents/intent.js";
import { runInvocation } from "../intents/invocation/lifecycle.js";
import { ModuleContext } from "../intents/invocation/module-context.js";
import type { Frame } from "../runtime/index.js";
import { fmt } from "./fmt.js";

/** The third argument of a lowered `__nola.ask` (spec 2026-09-29 §3.3): the `ask with <name>` alias plus what the site sees. */
export interface AskSite extends VisibleContext {
  readonly model?: string;
}

/**
 * `ask expr` — validate the operand is an Intent and run it against the asking
 * scope's frame. Context chains here: this is the only place a parent frame
 * reaches an intent. Inside an infer body the scope IS the frame; the module
 * body has no wrapper to mint one, so it passes its scope node and a
 * `<module>` root is opened here — one per ask, with the asked intent's own
 * timeout as its clock (at module level the ask is the root; whether asks
 * share one module frame is this function's decision, never the emitted
 * text's). `site.model` is the `ask with <name>` alias; being the ask-site
 * choice it overrides an intent's own .withModel pin (forceModel still beats
 * both — resolveModel owns that precedence). `site.locals` and `site.context`
 * are what the site sees; they ride the intent's options to the composer.
 */
export async function ask<T>(value: Askable<T>, scope: Frame | ModuleContext, site?: AskSite): Promise<T> {
  if (scope instanceof ModuleContext) {
    const timeout = Intent.isIntent(value) ? value.timeout : undefined;
    const root = scope.runtime.openFrame(scope, timeout === undefined ? {} : { timeout });
    return runInvocation(root, (frame) => ask(value, frame, site));
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
  if (site?.model !== undefined) intent = intent.withModel(site.model);
  if (site?.locals !== undefined || site?.context !== undefined) {
    intent = intent.withVisible({
      ...(site.locals !== undefined ? { locals: site.locals } : {}),
      ...(site.context !== undefined ? { context: site.context } : {}),
    });
  }
  return intent.run(frame);
}

/**
 * The context statement tag (spec 2026-09-29 §3.3): the lowered
 * `void __nola_ctx_N; function __nola_ctx_N() { return __nola.ctx`…`; }`
 * renders its text parts with every hole and juxtaposed value formatted by
 * `fmt`. Cooked text, raw
 * as the fallback for an escape the cooked form rejects. Receiving the live
 * values — not their text — is the seam a later design (tools) extends.
 */
export function ctx(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = strings[0] ?? strings.raw[0] ?? "";
  for (let i = 0; i < values.length; i++) out += fmt(values[i]) + (strings[i + 1] ?? strings.raw[i + 1] ?? "");
  return out;
}
