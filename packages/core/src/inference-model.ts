import type { ProviderOutput } from "./index.js";

/** One infer-function argument as the model sees it — native type TEXT, live value. */
export interface InferenceScopeArg {
  name: string;
  /** InferType.toNativeType(); absent when unannotated/underivable */
  type?: string;
  /** true ⇔ the param was `.`-prefixed (value available) */
  contextual: boolean;
  /** only when contextual */
  value?: unknown;
  /** true ⇔ a `.`-contextual BINDING visible at the ask site (scope-bodies spec §3.3), not a parameter */
  local?: true;
}

/** The asking infer function's frame; `parent` is the caller frame's scope. */
export interface InferenceScope {
  fn: string;
  /** true ⇔ the module body's implicit `<module>` scope */
  module?: true;
  /**
   * true ⇔ a module scope composed from the DEFINITION site of the scope
   * inside it (the module its function is declared in), not opened by a
   * caller (spec 2026-09-26 §3.3). Its args are always empty: bindings are
   * never carried lexically.
   */
  lexical?: true;
  /** display path of the defining .tsi; absent without a file root */
  file?: string;
  /** the scope's instruction text ("" when none; a holed instruction is already formatted) */
  instruction: string;
  args: InferenceScopeArg[];
  parent?: InferenceScope;
}

export interface InferenceCorrection {
  /** the provider's rejected reply */
  response: string;
  /** the validation error it failed with */
  error: string;
}

/**
 * The canonical, pure-JSON description of one ask. Fingerprints, ledgers,
 * receipts and hook events are defined over it; the text a provider sends
 * is a derived view (`renderPrompt`, or the provider's own). No closures,
 * no InferType instances.
 */
export interface InferenceModel {
  /** "extract" for an extractor, "call" for the slot-filling ask of a call intent */
  intent: "extract" | "call";
  input: {
    /** the authored backtick text, holes already formatted (or the call intent's synthesized request) */
    instruction: string;
    /** call intents only: the callee's name */
    callee?: string;
    /** call intents only: the authored hint; absent when the author wrote none */
    hint?: string;
  };
  /** innermost first; absent for a frame-less ask */
  scope?: InferenceScope;
  /** the user's config `system.message` — never the built-in preamble */
  system?: string;
  output: ProviderOutput;
  /** present on the correction attempt only; never fingerprint input */
  correction?: InferenceCorrection;
}
