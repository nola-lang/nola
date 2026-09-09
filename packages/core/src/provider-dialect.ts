import type { InferenceModel } from "./inference-model.js";
import type { ClassicPrompt } from "./render-classic.js";

/**
 * Payload union for hook events and the fingerprint: the canonical model
 * for a managed ask, its classic rendering for everyone else. Requests no
 * longer carry the union (reshape design 2026-09-01) — the method name is
 * the dialect: `infer` takes `InferRequest { model }`, `complete` takes
 * `ProviderRequest { payload: ClassicPrompt }`.
 */
export type ProviderPayload = ClassicPrompt | InferenceModel;

/** Structural discriminator between the two payload shapes (a ClassicPrompt has no `intent`). */
export function isInferenceModel(payload: ProviderPayload): payload is InferenceModel {
  return "intent" in payload;
}
