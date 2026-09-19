import type { AskKind, JsonSchema } from "@nola-lang/core";
import type { FunctionArg } from "../intents/invocation/invocation-context.js";
import type { InferType } from "../types/infer-type.js";
import type { ExtractPromptScope, FunctionPromptScope, PromptTemplate } from "./prompt-render.js";

/** What the ask-site node contributes. */
export interface IntentInput {
  instruction: string;
  /** lowered `${.member}` prompt — rendered into `model.input.text` */
  template?: PromptTemplate<ExtractPromptScope>;
  /** call intents only */
  callee?: string;
  hint?: string;
}

/** What one infer-function frame contributes. */
export interface ScopeDescription {
  fn: string;
  /** the module body's implicit scope */
  module?: true;
  file?: string;
  instruction: string;
  args: readonly FunctionArg[];
  /** lowered `${.member}` marker — rendered into `scope.text` */
  template?: PromptTemplate<FunctionPromptScope>;
}

export interface IntentComposer {
  input(init: IntentInput): this;
  output(type?: JsonSchema | InferType<unknown>): this;
}

export interface ScopeComposer {
  describe(init: ScopeDescription): this;
}

/**
 * The node-facing sink `compose` overrides write into. Kept a leaf (no ask
 * module imports beyond types) so context nodes and Frame can depend on it.
 * The ask-site node calls intent(); a frame node calls scope(); Frame moves
 * to the caller's level with outer().
 */
export interface InferenceComposer {
  intent(kind: AskKind): IntentComposer;
  scope(): ScopeComposer;
  outer(): InferenceComposer;
}
