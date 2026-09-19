import type { DecisionQuestion, JsonSchema } from "./index.js";

/**
 * The decision capability (decision types spec 2026-09-18 §6.1): a model
 * carrying this brand answers `Choice` / `Scale` / `Prob` questions with real
 * probability distributions. A chat model handed the answer schema would
 * FABRICATE `confidence: 0.9`, so the runtime refuses a decision ask before
 * the network unless the resolved model is branded (NOLA3018). Combinators
 * carry the brand forward; `fallback` / `roundRobin` skip unbranded inners
 * on a decision ask.
 */
export const DECISION_MODEL: unique symbol = Symbol.for("nola.decisionModel");

export function isDecisionModel(value: unknown): boolean {
  return !!value && typeof value === "object" && (value as { [DECISION_MODEL]?: unknown })[DECISION_MODEL] === true;
}

export interface DecisionSite {
  /** dotted path from the schema root: "" for the root, "a.b", "items[]", "anyOf[1]", "$defs.P", "*" for additionalProperties */
  path: string;
  question: DecisionQuestion;
}

/** Every `x-nola-decision` node in a schema, in document order. `$ref`s are not followed (cycle-safe: `$defs` are walked once). */
export function findDecisionQuestions(schema: JsonSchema | undefined): DecisionSite[] {
  const out: DecisionSite[] = [];
  if (schema) walk(schema, "", out);
  return out;
}

const join = (base: string, key: string): string => (base === "" ? key : `${base}.${key}`);

function walk(node: JsonSchema, path: string, out: DecisionSite[]): void {
  const n = node as Record<string, unknown>;
  const question = n["x-nola-decision"] as DecisionQuestion | undefined;
  if (question) out.push({ path, question });
  const properties = n.properties as Record<string, JsonSchema> | undefined;
  if (properties) for (const [key, prop] of Object.entries(properties)) walk(prop, join(path, key), out);
  const items = n.items;
  if (items && typeof items === "object") walk(items as JsonSchema, `${path}[]`, out);
  const prefixItems = n.prefixItems as JsonSchema[] | undefined;
  if (prefixItems) for (const [i, item] of prefixItems.entries()) walk(item, `${path}[${i}]`, out);
  const anyOf = n.anyOf as JsonSchema[] | undefined;
  if (anyOf) for (const [i, member] of anyOf.entries()) walk(member, `${join(path, "anyOf")}[${i}]`, out);
  const additional = n.additionalProperties;
  if (additional && typeof additional === "object") walk(additional as JsonSchema, join(path, "*"), out);
  const defs = n.$defs as Record<string, JsonSchema> | undefined;
  if (defs) for (const [key, def] of Object.entries(defs)) walk(def, join(path, `$defs.${key}`), out);
}
