import type { InferRequest, InferResult, LanguageModel } from "./index.js";

/**
 * The platform-served model (platform-config design 2026-09-03, prompt
 * rendering 2026-09-28). Like every model it takes the canonical
 * InferenceModel through `infer`; the brand (not the method) is what makes
 * it the platform: root-only in the config, the `"nola"` alias, free-form
 * profiles, no combinators over it, `project` on the request.
 */
export const PLATFORM_MODEL: unique symbol = Symbol.for("nola.platformModel");

export interface PlatformModel extends LanguageModel {
  infer(req: InferRequest): Promise<InferResult>;
  readonly [PLATFORM_MODEL]: true;
}

export function isPlatformModel(value: unknown): value is PlatformModel {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { [PLATFORM_MODEL]?: unknown })[PLATFORM_MODEL] === true &&
    typeof (value as { infer?: unknown }).infer === "function"
  );
}
