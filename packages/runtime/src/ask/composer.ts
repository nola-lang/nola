import type { JsonSchema } from "@nola-lang/core";

/**
 * The node-facing sink `composeInferenceData` overrides write into. Kept a
 * leaf (no runtime-package imports) so context nodes and Frame can depend on
 * it without touching the ask module. Text accumulates; the schema is
 * single-write — under the outer→inner frame walk the innermost node's
 * schema wins.
 */
export interface InferenceComposer {
  addText(text: string): void;
  addSchema(schema: JsonSchema): void;
}
