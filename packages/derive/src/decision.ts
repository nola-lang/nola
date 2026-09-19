import type ts from "typescript";
import { TS } from "./ts.js";
import { DerivationError } from "./walk.js";

/**
 * Decision types (spec 2026-09-18 §3): `Choice` / `Scale` / `Prob` are
 * recognized on the RESOLVED type by their phantom member — `__nola_choice`,
 * `__nola_scale`, `__nola_prob` — so Pick / Partial / generics flatten first
 * and the criteria still come through. The `__nola` prefix is reserved in
 * .tsi, which is what makes the member name a safe signature. Malformed
 * criteria are NOLA2015, an authoring error thrown under every policy.
 */
const CODE = "NOLA2015";
const CHOICE = "__nola_choice";
const SCALE = "__nola_scale";
const PROB = "__nola_prob";

/** The combinator text for a decision type, or undefined when `type` is not one. */
export function decisionExpr(type: ts.Type, checker: ts.TypeChecker, owner: string): string | undefined {
  const prob = checker.getPropertyOfType(type, PROB);
  if (prob) return probExpr(phantom(prob, checker), checker, owner);
  const choice = checker.getPropertyOfType(type, CHOICE);
  if (choice) return choiceExpr(phantom(choice, checker), checker, owner);
  const scale = checker.getPropertyOfType(type, SCALE);
  if (scale) return scaleExpr(phantom(scale, checker), checker, owner);
  return undefined;
}

/** The type argument the phantom member carries: its declared type minus the optional `undefined`. */
function phantom(member: ts.Symbol, checker: ts.TypeChecker): ts.Type {
  return checker.getNonNullableType(checker.getTypeOfSymbol(member));
}

/** A description's value: a string literal, or `null` (kept — `getNonNullableType` would eat it); optional `undefined` dropped. */
function literalOrNull(declared: ts.Type): string | null | undefined {
  const members = declared.isUnion() ? declared.types.filter((m) => !(m.flags & TS.TypeFlags.Undefined)) : [declared];
  const t = members.length === 1 ? members[0] : undefined;
  if (!t) return undefined;
  if (t.flags & TS.TypeFlags.StringLiteral) return (t as ts.StringLiteralType).value;
  if (t.flags & TS.TypeFlags.Null) return null;
  return undefined;
}

/** A description map's key was written as a number literal (`{ 1: "Low" }`) — TS keeps `keyof` numeric for those. */
function numericKey(prop: ts.Symbol): boolean {
  return (prop.declarations ?? []).some((d) => TS.isPropertySignature(d) && TS.isNumericLiteral(d.name));
}

/**
 * Labels are string or number literals, mixed freely. The criteria are keyed
 * by each label's TEXT (the wire's and `probabilities`' keys); the labels
 * written as numbers are listed under `numeric` so the runtime answers the
 * number for those. Two labels with one text (`1 | "1"`) cannot be told
 * apart on the wire, so that is NOLA2015.
 */
function choiceExpr(arg: ts.Type, checker: ts.TypeChecker, owner: string): string {
  const criteria: Record<string, string | null> = {};
  const numbers = new Set<string>();
  const add = (text: string, isNumber: boolean, description: string | null): void => {
    if (text in criteria) {
      throw new DerivationError(
        `${owner}: Choice labels ${text} and ${JSON.stringify(text)} share the text ${JSON.stringify(text)}`,
        CODE,
      );
    }
    criteria[text] = description;
    if (isNumber) numbers.add(text);
  };
  const literals = arg.isUnion() ? arg.types : [arg];
  if (literals.every((m) => m.flags & (TS.TypeFlags.StringLiteral | TS.TypeFlags.NumberLiteral))) {
    for (const m of literals) {
      const isNumber = (m.flags & TS.TypeFlags.NumberLiteral) !== 0;
      add(String((m as ts.StringLiteralType | ts.NumberLiteralType).value), isNumber, null);
    }
  } else if (arg.flags & TS.TypeFlags.Object) {
    for (const prop of checker.getPropertiesOfType(arg)) {
      const d = literalOrNull(checker.getTypeOfSymbol(prop));
      if (d === undefined) {
        throw new DerivationError(
          `${owner}: Choice description for ${JSON.stringify(prop.name)} must be a string literal or null`,
          CODE,
        );
      }
      add(prop.name, numericKey(prop), d);
    }
  } else {
    throw new DerivationError(`${owner}: Choice takes a label union or a { label: description } type literal`, CODE);
  }
  const labels = Object.keys(criteria);
  if (labels.length < 2 || labels.length > 255) {
    throw new DerivationError(`${owner}: Choice needs 2 to 255 labels, got ${labels.length}`, CODE);
  }
  const numeric = labels.filter((l) => numbers.has(l));
  const options = numeric.length > 0 ? `, { numeric: ${JSON.stringify(numeric)} }` : "";
  return `__nola.types.choice(${JSON.stringify(criteria)}${options})`;
}

function scaleExpr(arg: ts.Type, checker: ts.TypeChecker, owner: string): string {
  if (!checker.isTupleType(arg)) throw new DerivationError(`${owner}: Scale takes a tuple of level descriptions`, CODE);
  const target = (arg as ts.TypeReference).target as ts.TupleType;
  if (target.elementFlags.some((f) => f & (TS.ElementFlags.Rest | TS.ElementFlags.Optional))) {
    throw new DerivationError(`${owner}: Scale levels must be a fixed tuple of string literals`, CODE);
  }
  const levels = checker.getTypeArguments(arg as ts.TypeReference).map((t) => {
    if (!(t.flags & TS.TypeFlags.StringLiteral)) {
      throw new DerivationError(`${owner}: Scale levels must be string literals`, CODE);
    }
    return (t as ts.StringLiteralType).value;
  });
  if (levels.length < 2 || levels.length > 10) {
    throw new DerivationError(`${owner}: Scale needs 2 to 10 levels, got ${levels.length}`, CODE);
  }
  return `__nola.types.scale(${JSON.stringify(levels)})`;
}

function probExpr(arg: ts.Type, checker: ts.TypeChecker, owner: string): string {
  if (arg.flags & TS.TypeFlags.Never) return "__nola.types.prob()";
  const props = checker.getPropertiesOfType(arg);
  const names = props.map((p) => p.name).sort();
  const extra = names.filter((n) => n !== "true" && n !== "false");
  if (extra.length > 0 || names.length !== 2) {
    throw new DerivationError(
      `${owner}: Prob criteria must be exactly { true: "…"; false: "…" }, got ${extra.length > 0 ? extra.join(", ") : names.join(", ")}`,
      CODE,
    );
  }
  const criteria: Record<string, string> = {};
  for (const prop of props) {
    const t = checker.getNonNullableType(checker.getTypeOfSymbol(prop));
    if (!(t.flags & TS.TypeFlags.StringLiteral)) {
      throw new DerivationError(`${owner}: Prob criterion ${JSON.stringify(prop.name)} must be a string literal`, CODE);
    }
    criteria[prop.name] = (t as ts.StringLiteralType).value;
  }
  return `__nola.types.prob(${JSON.stringify({ true: criteria.true, false: criteria.false })})`;
}
