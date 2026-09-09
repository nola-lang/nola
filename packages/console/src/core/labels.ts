import type { AskKind } from "@nola-lang/core";

const INSTRUCTION_MAX = 80;

/** One line, whitespace collapsed, cut to INSTRUCTION_MAX characters with an ellipsis. */
function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > INSTRUCTION_MAX ? `${flat.slice(0, INSTRUCTION_MAX - 1)}…` : flat;
}

/** `triage(..)` — the infer function as a call; `<anonymous>` for a scope-less root. */
export function invocationLabel(fn: string | undefined): string {
  return `${fn ?? "<anonymous>"}(..)`;
}

/**
 * The ask as the author wrote it: ``..`instruction`<T>`` for an extract,
 * ``callee`hint`(..)`` for a call. Display text only — never identity.
 */
export function askLabel(ask: {
  kind: AskKind;
  instruction?: string;
  callee?: string;
  hint?: string;
  typeText?: string;
}): string {
  if (ask.kind === "call") {
    const hint = ask.hint ? `\`${excerpt(ask.hint)}\`` : "";
    return `${ask.callee ?? "?"}${hint}(..)`;
  }
  const type = ask.typeText ? `<${ask.typeText}>` : "";
  return `..\`${excerpt(ask.instruction ?? "")}\`${type}`;
}
