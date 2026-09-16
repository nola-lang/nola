import type ts from "typescript";
import { TS } from "./ts.js";
import { DerivationError } from "./walk.js";

/**
 * JSDoc constraint tags (spec 2026-09-15): the JSON Schema validation
 * vocabulary, read from a member's or an alias's JSDoc and emitted as
 * `.constrain({ … })`. The keys are the keywords. Anything malformed is
 * NOLA2012 — nothing reaches a schema unvalidated.
 */
export interface Constraints {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  integer?: true;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: true;
}

export type ConstraintKind = "string" | "number" | "array";

const NUMBER_TAGS = ["minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minItems", "maxItems"] as const;
const FLAG_TAGS = ["integer", "uniqueItems"] as const;
const TEXT_TAGS = ["pattern", "format"] as const;
export const FORMATS = ["date-time", "date", "time", "email", "uri", "uuid", "ipv4", "ipv6", "hostname"] as const;

const KIND_OF: Record<keyof Constraints, ConstraintKind> = {
  minLength: "string",
  maxLength: "string",
  pattern: "string",
  format: "string",
  minimum: "number",
  maximum: "number",
  exclusiveMinimum: "number",
  exclusiveMaximum: "number",
  multipleOf: "number",
  integer: "number",
  minItems: "array",
  maxItems: "array",
  uniqueItems: "array",
};

const CODE = "NOLA2012";

/** The constraint tags on `symbol`, or undefined when it carries none. Unrelated tags are ignored. */
export function parseConstraintTags(symbol: ts.Symbol, checker: ts.TypeChecker, owner: string): Constraints | undefined {
  const out: Constraints = {};
  let any = false;
  for (const tag of symbol.getJsDocTags(checker)) {
    const name = tag.name as keyof Constraints;
    if (!(name in KIND_OF)) continue;
    if (name in out) throw new DerivationError(`${owner}: @${name} is given twice`, CODE);
    const text = TS.displayPartsToString(tag.text ?? []).trim();
    any = true;
    if ((NUMBER_TAGS as readonly string[]).includes(name)) {
      const n = text === "" ? Number.NaN : Number(text);
      if (!Number.isFinite(n)) {
        throw new DerivationError(`${owner}: @${name} needs a number${text === "" ? "" : `, got '${text}'`}`, CODE);
      }
      (out as Record<string, number>)[name] = n;
    } else if ((FLAG_TAGS as readonly string[]).includes(name)) {
      if (text !== "") throw new DerivationError(`${owner}: @${name} takes no value, got '${text}'`, CODE);
      (out as Record<string, true>)[name] = true;
    } else if ((TEXT_TAGS as readonly string[]).includes(name)) {
      if (text === "") throw new DerivationError(`${owner}: @${name} needs a value`, CODE);
      if (name === "format" && !(FORMATS as readonly string[]).includes(text)) {
        throw new DerivationError(`${owner}: unknown @format '${text}' (expected ${FORMATS.join(", ")})`, CODE);
      }
      if (name === "pattern") {
        try {
          new RegExp(text);
        } catch (e) {
          throw new DerivationError(`${owner}: @pattern is not a valid regular expression: ${(e as Error).message}`, CODE);
        }
      }
      (out as Record<string, string>)[name] = text;
    }
  }
  return any ? out : undefined;
}

/**
 * The kind a constrained type must have: string (incl. literal unions and
 * string enums), number (incl. numeric literals), array (incl. tuples) —
 * decided on the non-null, non-undefined part. Undefined for anything else.
 */
export function constraintKindOf(type: ts.Type, checker: ts.TypeChecker): ConstraintKind | undefined {
  const members = type.isUnion() ? type.types.filter((m) => !(m.flags & (TS.TypeFlags.Null | TS.TypeFlags.Undefined))) : [type];
  const kinds = new Set(members.map((m) => kindOfSingle(m, checker)));
  return kinds.size === 1 ? [...kinds][0] : undefined;
}

function kindOfSingle(t: ts.Type, checker: ts.TypeChecker): ConstraintKind | undefined {
  if (t.flags & (TS.TypeFlags.String | TS.TypeFlags.StringLiteral)) return "string";
  if (t.flags & (TS.TypeFlags.Number | TS.TypeFlags.NumberLiteral)) return "number";
  if (t.flags & TS.TypeFlags.Object && (checker.isArrayType(t) || checker.isTupleType(t))) return "array";
  return undefined;
}

/** Throws NOLA2012 when a keyword does not fit the type's kind. */
export function assertApplicable(c: Constraints, kind: ConstraintKind | undefined, owner: string, typeText: string): void {
  for (const key of Object.keys(c) as (keyof Constraints)[]) {
    const needed = KIND_OF[key];
    if (needed !== kind) {
      throw new DerivationError(`${owner}: @${key} applies to ${needed}s, not to ${typeText}`, CODE);
    }
  }
}
