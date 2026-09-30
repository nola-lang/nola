import { Codes } from "@nola-lang/ast";
import { NolaConfigError } from "@nola-lang/core";

/**
 * Every model a combinator (or `record`) wraps must speak the one dialect —
 * `infer(req)`. A `complete`-only inner is the retired chat form and gets the
 * same NOLA3003 migration message the config resolver gives a root model;
 * anything else is not a model. Checked at construction so the failure is
 * a config error, never a TypeError at the first ask (prompt-rendering spec
 * 2026-09-28 §3.10).
 */
export function requireInfer(models: readonly unknown[], where: string): void {
  for (const m of models) {
    const o = m as { name?: unknown; infer?: unknown; complete?: unknown } | null;
    if (o && typeof o === "object" && typeof o.infer === "function") continue;
    const name = o && typeof o === "object" && typeof o.name === "string" ? o.name : String(m);
    if (o && typeof o === "object" && typeof o.complete === "function") {
      throw new NolaConfigError(
        `${where}(${name}) implements complete(req) — a model implements infer(req) and receives the InferenceModel; render it with renderPrompt() from @nola-lang/providers and return { text, sent }.`,
        Codes.ConfigInvalid,
      );
    }
    throw new NolaConfigError(`${where}(${name}) is not a model (need { name: string, infer(req) }).`, Codes.ConfigInvalid);
  }
}
