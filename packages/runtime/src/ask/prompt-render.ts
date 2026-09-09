import { Codes } from "@nola-lang/ast";
import { NolaIntentError } from "@nola-lang/core";

export { isTrivialStringSchema, joinBlocks } from "@nola-lang/core";

/** A lowered `${.member}` template: renders one intent's block from its prompt scope. */
export type PromptTemplate<S> = (scope: S) => string;

/**
 * One infer-function argument as a template sees it (native type text). `value`
 * is the JSON-normalized form of the live value, built from the model —
 * exactly what crosses the wire (a `Date` reads as its ISO string, not a
 * `Date` instance); `undefined` for a function/symbol value or an absent
 * contextual argument.
 */
export interface FunctionPromptScopeArg {
  readonly name: string;
  readonly type?: string;
  readonly contextual: boolean;
  readonly value?: unknown;
}

/** Scope of an infer-function marker template — the CONTEXT block (spec §3.4). */
export interface FunctionPromptScope {
  readonly fn: string;
  readonly signature: string;
  readonly file?: string;
  readonly args: readonly FunctionPromptScopeArg[];
  readonly nested: boolean;
  readonly hasContext: boolean;
  /** today's CONTEXT block for this frame (no Purpose line — the template IS the instruction) */
  readonly default: string;
  /** the rest of the chain rendered (callee frames + TASK); memoized */
  readonly next: string;
}

/** Scope of an extractor / call-intent template — the TASK block (spec §3.4). */
export interface ExtractPromptScope {
  /** native type text of the target */
  readonly type: string;
  /** the wire JSON Schema, serialized */
  readonly schema: string;
  readonly hasContext: boolean;
  /** today's TASK block */
  readonly default: string;
  /** the response discipline lines; appended after the template when it never reads them */
  readonly format: string;
}

/**
 * Runs a prompt template. A template that throws or renders blank is a
 * definitive NOLA3014 (there is no sensible prompt to send). `tail` is the
 * text the template may place itself (`.format`); when the template did not
 * read it (`tailRead()` false) it is appended after the template so nothing
 * the parser contract relies on can be dropped by omission.
 */
export function renderTemplate<S>(template: PromptTemplate<S>, scope: S, site: string, tail: () => string, tailRead: () => boolean): string {
  let text: unknown;
  try {
    text = template(scope);
  } catch (e) {
    throw new NolaIntentError(
      `${Codes.PromptTemplateFailed}: prompt template at ${site} threw: ${e instanceof Error ? e.message : String(e)}`,
      Codes.PromptTemplateFailed,
    );
  }
  if (typeof text !== "string" || text.trim() === "") {
    throw new NolaIntentError(`${Codes.PromptTemplateFailed}: prompt template at ${site} rendered no text.`, Codes.PromptTemplateFailed);
  }
  if (tailRead()) return text;
  const rest = tail();
  return rest ? `${text}\n\n${rest}` : text;
}
