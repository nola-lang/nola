import type { JsonSchema, ProviderOutput } from "./index.js";

/** A tool the ask offers (tool-use spec 2026-10-08 §3.6): the written name, the function's JSDoc summary, the parameter schema. */
export interface ToolDescription {
  name: string;
  description?: string;
  parameters: JsonSchema;
}

/** One tool call the model requested, with its result as rendered for the model (the `fmt` rule). */
export interface ToolCallRecord {
  id: string;
  /** the name as the model used it — the wire name */
  name: string;
  args: unknown;
  result: string;
}

/** One tool turn: the model's text, if any, and the calls it requested in order, each with its result. */
export interface ToolUseTurn {
  text?: string;
  calls: readonly ToolCallRecord[];
}

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

/** A bare value of an ask sequence as the model sees it (spec 2026-10-12 §3.7): the written name, the native type text, the value as it was when the ask ran. */
export interface InferenceInputValue {
  name: string;
  /** InferType.toNativeType(); absent when the walk could not type the expression */
  type?: string;
  /** JSON-safe; absent for `undefined` */
  value?: unknown;
}

/**
 * One part of an ask sequence's instruction (spec 2026-10-12 §3.7), in
 * written order: a text (holes formatted), a bare value as an input, one
 * list's tools by WIRE name (the definitions ride in `tools`), or the call
 * part as `describe()` prints it, e.g. `createUser(user id)`.
 */
export type InferencePart = { text: string } | { input: InferenceInputValue } | { tools: readonly string[] } | { call: string };

/**
 * The canonical, pure-JSON description of one ask. Fingerprints, ledgers,
 * receipts and hook events are defined over it; the text a provider sends
 * is a derived view (`renderPrompt`, or the provider's own). No closures,
 * no InferType instances.
 */
export interface InferenceModel {
  /** "extract" for an extractor, "call" for the slot-filling ask of a call intent, "tool-use" for an ask with a tool list */
  intent: "extract" | "call" | "tool-use";
  /** tool-use only: the tools offered, in written order (present-only — absent on every other ask, so fingerprints hold) */
  tools?: readonly ToolDescription[];
  /** tool-use only: the turns so far — absent on the first turn */
  transcript?: readonly ToolUseTurn[];
  input: {
    /** the authored backtick text, holes already formatted (or the call intent's synthesized request) */
    instruction: string;
    /** call intents only: the callee's name */
    callee?: string;
    /** call intents only: the authored hint; absent when the author wrote none, and in the sequence form, where the texts are the words */
    hint?: string;
    /**
     * The ask sequence (spec 2026-10-12 §3.7): present ONLY when the ask has
     * values — every other ask's model is byte-identical to before, so
     * fingerprints hold. `instruction` is then the reference text (the texts
     * with each value's reference) for labels and providers that ignore parts.
     */
    parts?: readonly InferencePart[];
  };
  /** innermost first; absent for a frame-less ask */
  scope?: InferenceScope;
  /** the user's config `system.message` — never the built-in preamble */
  system?: string;
  output: ProviderOutput;
  /** present on the correction attempt only; never fingerprint input */
  correction?: InferenceCorrection;
}
