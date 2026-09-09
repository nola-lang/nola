import type { AskTrace, ProviderParams, ProviderResponse } from "./index.js";
import type { InferenceModel } from "./inference-model.js";

/**
 * The platform-served model (platform-config design 2026-09-03). It is the
 * ONLY `infer`-dialect model: the runtime hands it the canonical
 * InferenceModel, every other model receives the classic rendering through
 * `complete`. The brand (not the method) is the detection gate, so a user
 * object that happens to have an `infer` method is still a config error.
 */
export const PLATFORM_MODEL: unique symbol = Symbol.for("nola.platformModel");

/** The request a platform model consumes: the canonical model, never a rendering. */
export interface InferRequest {
  model: InferenceModel;
  params?: ProviderParams;
  signal?: AbortSignal;
  trace?: AskTrace;
  /** Free-form inference profile (`ask with <name>` under a platform default). Part of the ask fingerprint. */
  profile?: string;
  /** The app's project name — deployment metadata for the server, NEVER part of the ask fingerprint. */
  project?: string;
}

export interface PlatformModel {
  readonly name: string;
  infer(req: InferRequest): Promise<ProviderResponse>;
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
