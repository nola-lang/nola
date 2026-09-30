import type { AskKind, JsonSchema } from "@nola-lang/core";
import type { FunctionArg } from "../intents/invocation/invocation-context.js";
import type { InferType } from "../types/infer-type.js";

/** What the ask-site node contributes. */
export interface IntentInput {
  instruction: string;
  /** call intents only */
  callee?: string;
  hint?: string;
}

/** What one infer-function frame contributes. */
export interface ScopeDescription {
  fn: string;
  /** the module body's implicit scope */
  module?: true;
  /** the module a function is DEFINED in, composed from that definition site — never a caller (spec 2026-09-26 §3.3) */
  lexical?: true;
  file?: string;
  instruction: string;
  args: readonly FunctionArg[];
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
