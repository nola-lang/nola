import { type PlatformModel, type PlatformOptions, platformModel } from "./platform-model.js";
import { tracer } from "./tracer.js";

/** `nola.infer(...)`'s options: the platform connection plus the optional upstream selector. */
export type InferOptions = PlatformOptions & { model?: string };

/**
 * The platform model (config v2 §2): no argument lets the platform choose,
 * a string locks the upstream selector, an object carries the connection.
 */
function infer(model?: string | InferOptions): PlatformModel {
  if (model === undefined) return platformModel({});
  if (typeof model === "string") return platformModel({ model });
  return platformModel(model);
}

/**
 * The `nola` namespace (config v2 §1): what a Nola-Protocol server can
 * serve, one factory per config slot. Frozen and NOT callable — the callable
 * preset form is reserved for a later design.
 */
export const nola: Readonly<{ infer: typeof infer; tracer: typeof tracer }> = Object.freeze({ infer, tracer });
