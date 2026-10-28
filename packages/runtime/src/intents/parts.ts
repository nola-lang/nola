import { Codes } from "@nola-lang/ast";
import { type InferencePart, NolaIntentError, toolWireName } from "@nola-lang/core";
import { fmt } from "../ask/fmt.js";
import { type InferType, TypeCarrier } from "../types/infer-type.js";
import { materializeTools, type ToolSource } from "./tool-use/tool-group.js";
import type { ToolEntry } from "./tool-use/tool-use-context.js";

/**
 * The value parts of an ask sequence (spec 2026-10-12 §3.6), as `__nola.var`
 * builds them (emit 24): a bare value with its written name and the walk's
 * type, a tool list over deferred sources, the call part. A text part is a
 * plain string. Branded, so a hand-written init cannot pass a plain object
 * — no lowering emits one.
 */
const PART = Symbol.for("nola.instruction-part");

export interface ObjPart {
  readonly kind: "obj";
  readonly value: unknown;
  readonly name: string;
  readonly type?: InferType<unknown> | undefined;
}
export interface ToolsPart {
  readonly kind: "tools";
  readonly sources: readonly (ToolEntry | ToolSource)[];
}
export interface FuncPart {
  readonly kind: "func";
  readonly fn: unknown;
  readonly name: string;
  readonly args: readonly unknown[];
}
export type ValuePart = ObjPart | ToolsPart | FuncPart;
export type InstructionPart = string | ValuePart;

function brand<T extends object>(part: T): T {
  Object.defineProperty(part, PART, { value: true });
  return Object.freeze(part);
}

/** `__nola.var` */
export const instructionParts = {
  /** a bare value: `{ value, name, type? }` — the type is the optional value accessor's answer */
  obj: (init: { value: unknown; name: string; type?: InferType<unknown> | undefined }): ObjPart =>
    brand({ kind: "obj" as const, value: init.value, name: init.name, ...(init.type !== undefined ? { type: init.type } : {}) }),
  /** one `[list]`: today's deferred sources */
  tools: (...sources: readonly (ToolEntry | ToolSource)[]): ToolsPart => brand({ kind: "tools" as const, sources }),
  /** the call part: what `fn`, `name` and `args` carry on a bare call intent */
  func: (init: { fn: unknown; name: string; args: readonly unknown[] }): FuncPart =>
    brand({ kind: "func" as const, fn: init.fn, name: init.name, args: init.args }),
};

export function isValuePart(v: unknown): v is ValuePart {
  return typeof v === "object" && v !== null && (v as Record<symbol, unknown>)[PART] === true;
}

/** A string init is one text part; anything that is not a text or a branded part is an emit-contract breach (NOLA3001). */
export function normalizeParts(instruction: string | readonly InstructionPart[]): readonly InstructionPart[] {
  if (typeof instruction === "string") return [instruction];
  for (const p of instruction) {
    if (typeof p !== "string" && !isValuePart(p)) {
      throw new NolaIntentError(
        "an instruction part must be a text or one of __nola.var's values — rebuild the project.",
        Codes.EmitContractMismatch,
      );
    }
  }
  return instruction;
}

/** The parts a class takes; the others are an emit-contract breach at construction (spec §3.6). */
export function requireParts(parts: readonly InstructionPart[], allowed: readonly ValuePart["kind"][], className: string): void {
  for (const p of parts) {
    if (typeof p !== "string" && !allowed.includes(p.kind)) {
      throw new NolaIntentError(`${className} takes no ${p.kind} part — rebuild the project.`, Codes.EmitContractMismatch);
    }
  }
}

/** A list's tools by wire name; an invalid list answers no names — `entries()` raises NOLA3022 where the model composes. */
function wireNames(part: ToolsPart): string[] {
  return materializeTools(part.sources).entries.map((e) => toolWireName(e.name));
}

/** A value part's reference (spec §1.6): an input's name, a list's bracketed wire names, a call as describe() prints it. */
function reference(part: ValuePart): string {
  switch (part.kind) {
    case "obj":
      return part.name;
    case "tools":
      return `[${wireNames(part).join(", ")}]`;
    case "func":
      return `${part.name}(${part.args.map((a) => fmt(a)).join(", ")})`;
  }
}

/** The instruction string on the wire, in labels and history: the texts with each value's reference, joined by one space. */
export function referenceText(parts: readonly InstructionPart[]): string {
  return parts.map((p) => (typeof p === "string" ? p : reference(p))).join(" ");
}

/** The parts as words only — the slot degrade (spec §3.6): a bare value through fmt, the rest by reference. */
export function inlineText(parts: readonly InstructionPart[]): string {
  return parts.map((p) => (typeof p === "string" ? p : p.kind === "obj" ? fmt(p.value) : reference(p))).join(" ");
}

/** The wire parts (spec §3.7) — present only when the sequence has a value part, so a one-text ask's model holds. */
export function wireParts(parts: readonly InstructionPart[]): InferencePart[] | undefined {
  if (!parts.some((p) => typeof p !== "string")) return undefined;
  return parts.map((p): InferencePart => {
    if (typeof p === "string") return { text: p };
    if (p.kind === "obj") {
      // the same JSON round trip as a scope arg's value (model-builder.ts): a function or symbol value is omitted
      const json = p.value === undefined ? undefined : JSON.stringify(p.value);
      return {
        input: {
          name: p.name,
          ...(TypeCarrier.is(p.type) ? { type: p.type.toNativeType() } : {}),
          ...(json !== undefined ? { value: JSON.parse(json) } : {}),
        },
      };
    }
    if (p.kind === "tools") return { tools: wireNames(p) };
    return { call: reference(p) };
  });
}
