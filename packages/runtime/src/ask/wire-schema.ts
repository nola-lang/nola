import type { JsonSchema } from "@nola-lang/core";
import { InferType } from "../types/infer-type.js";

/** The wire contract: undefined → free text, InferType → derived JSON schema. */
export function wireSchema(type?: JsonSchema | InferType<unknown>): JsonSchema {
  return type === undefined ? { type: "string" } : InferType.isInferType(type) ? type.toJsonSchema() : type;
}
