import type { DecisionQuestion, InferenceModel, InferenceScope, JsonSchema } from "@nola-lang/core";
import { joinBlocks } from "@nola-lang/core";

/**
 * The decisions wire dialect (spec 2026-09-18 §6.2–6.3): typesafe.ai's
 * System One and OpenRouter's Decisions API take one JSON `state` and a map
 * of named typed questions — choice / score / noul — and answer every one
 * with a probability distribution. This module turns an InferenceModel into
 * that request and its answers back into the values the ask's carrier
 * validates. Pure: no fetch, no vendor URL, so every wire over the dialect
 * shares it.
 */

/** `instructions` may be a string or a JSON object on the wire (UNVERIFIED against the live API: the object form). */
export type Instructions = string | { context: string; question: string };

export type DecisionWireQuestion =
  | { type: "choice"; instructions: Instructions; criteria: Record<string, string | null> }
  | { type: "score"; instructions: Instructions; criteria: string[] }
  | { type: "noul"; instructions: Instructions; criteria?: { true: string; false: string } };

export type DecodeResult = { ok: true; value: unknown } | { ok: false; reason: string };
/** Turns the wire answer for one question into the JSON value the ask expects. */
export type Decoder = (answer: unknown) => DecodeResult;

export interface DecisionPlan {
  /** JSON: the contextual values by name (innermost wins), or the ask's instruction text when there are none */
  state: unknown;
  questions: Record<string, DecisionWireQuestion>;
  decode: Record<string, Decoder>;
  /** true ⇔ the reply is the bare "value" answer, not an object of answers */
  scalar: boolean;
}

export type PlanResult = { ok: true; plan: DecisionPlan } | { ok: false; reason: string };

const SERVES = "typesafe() serves Choice, Scale and Prob, literal unions and booleans";
const SCALAR_QUESTION = "Determine the value the request asks for.";

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

// ---- state and context ----

/** Scopes outer→inner (the model lists them innermost first through `parent`). */
function scopesOuterFirst(scope: InferenceScope | undefined): InferenceScope[] {
  const out: InferenceScope[] = [];
  for (let s = scope; s; s = s.parent) out.unshift(s);
  return out;
}

/** The contextual values by name, outer→inner so an inner binding shadows an outer one; undefined when there are none. */
function contextualState(model: InferenceModel): Record<string, unknown> | undefined {
  const state: Record<string, unknown> = {};
  let any = false;
  for (const scope of scopesOuterFirst(model.scope)) {
    for (const arg of scope.args) {
      if (arg.contextual && "value" in arg) {
        state[arg.name] = arg.value;
        any = true;
      }
    }
  }
  return any ? state : undefined;
}

const askText = (model: InferenceModel): string => model.input.text ?? model.input.instruction;

/** What the model says about the ask, outer→inner: system, each scope's text, then (optionally) the ask text. */
function contextText(model: InferenceModel, includeAskText: boolean): string {
  const parts = [
    model.system ?? "",
    ...scopesOuterFirst(model.scope).map((s) => s.text ?? s.instruction),
    includeAskText ? askText(model) : "",
  ];
  return parts.filter((p) => p.trim() !== "").reduce((acc, p) => joinBlocks(acc, p), "");
}

// ---- schema → questions ----

type Defs = Record<string, JsonSchema> | undefined;
type Resolved = { ok: true; node: JsonSchema; description?: string } | { ok: false; reason: string };

/** Follow a `$ref` chain through the root `$defs`; the FIRST description seen along the chain wins. */
function resolve(node: JsonSchema, defs: Defs, path: string): Resolved {
  let current = node;
  let description = node.description;
  const seen = new Set<string>();
  while ("$ref" in current) {
    const ref = current.$ref;
    if (seen.has(ref)) return fail(`${path} is a cyclic reference ${JSON.stringify(ref)}; ${SERVES}`);
    seen.add(ref);
    const name = /^#\/\$defs\/(.+)$/.exec(ref)?.[1];
    const next = name ? defs?.[name] : undefined;
    if (!next) return fail(`${path} is an unresolved reference ${JSON.stringify(ref)}; ${SERVES}`);
    current = next;
    description ??= current.description;
  }
  return description === undefined ? { ok: true, node: current } : { ok: true, node: current, description };
}

/** What an unsupported node is, in the words of the failure reason. */
function kindOf(node: JsonSchema): string {
  if ("const" in node) return "a single literal";
  if ("anyOf" in node) return "a union that is not all string literals or all number literals";
  if ("type" in node) {
    switch (node.type) {
      case "string":
        return node.format === "date-time" ? "a date-time string" : "a free-form string";
      case "number":
      case "integer":
        return "a number";
      case "array":
        return "an array";
      case "object":
        return "properties" in node ? "a nested object" : "a record";
      case "null":
        return "null";
    }
  }
  return "an unsupported shape";
}

type Mapped = { ok: true; question: DecisionWireQuestion; decode: Decoder } | { ok: false; reason: string };

const missing = (key: string) => fail(`answer "${key}" is missing from the reply`);

function finiteOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** A plain literal union: labels are the literals; the decoder returns the JSON value the label stands for. */
function plainChoice(key: string, instructions: Instructions, labels: Map<string, unknown>): Mapped {
  const criteria: Record<string, string | null> = {};
  for (const label of labels.keys()) criteria[label] = null;
  const decode: Decoder = (answer) => {
    if (answer === undefined || answer === null) return missing(key);
    const choice = (answer as { choice?: unknown }).choice;
    if (typeof choice !== "string" || !labels.has(choice)) {
      return fail(`answer "${key}" chose ${JSON.stringify(choice)}, which is not one of the options sent`);
    }
    return { ok: true, value: labels.get(choice) };
  };
  return { ok: true, question: { type: "choice", instructions, criteria }, decode };
}

function plainNoul(key: string, instructions: Instructions, threshold: number): Mapped {
  const decode: Decoder = (answer) => {
    if (answer === undefined || answer === null) return missing(key);
    const noul = finiteOrUndefined((answer as { noul?: unknown }).noul);
    if (noul === undefined) return fail(`answer "${key}" has no numeric noul`);
    return { ok: true, value: noul > threshold };
  };
  return { ok: true, question: { type: "noul", instructions }, decode };
}

/** A decision node: the question is the node's own; the decoder builds the answer shape the carrier validates. */
function decisionQuestion(key: string, instructions: Instructions, q: DecisionQuestion): Mapped {
  switch (q.kind) {
    case "choice": {
      const labels = Object.keys(q.criteria);
      const decode: Decoder = (answer) => {
        if (answer === undefined || answer === null) return missing(key);
        const a = answer as { choice?: unknown; probabilities?: unknown; confidence?: unknown };
        if (typeof a.choice !== "string" || !labels.includes(a.choice)) {
          return fail(`answer "${key}" chose ${JSON.stringify(a.choice)}, which is not one of the options sent`);
        }
        if (a.probabilities === null || typeof a.probabilities !== "object") {
          return fail(`answer "${key}" has no probabilities object`);
        }
        const confidence = finiteOrUndefined(a.confidence);
        // the wire's label is its text; a label written as a number comes back as that number
        const choice = q.numeric?.includes(a.choice) ? Number(a.choice) : a.choice;
        return {
          ok: true,
          value: { choice, probabilities: a.probabilities, ...(confidence !== undefined ? { confidence } : {}) },
        };
      };
      return { ok: true, question: { type: "choice", instructions, criteria: { ...q.criteria } }, decode };
    }
    case "scale": {
      const levels = [...q.levels];
      const decode: Decoder = (answer) => {
        if (answer === undefined || answer === null) return missing(key);
        const a = answer as { score?: unknown; probabilities?: unknown; confidence?: unknown };
        const score = finiteOrUndefined(a.score);
        if (score === undefined) return fail(`answer "${key}" has no numeric score`);
        const byIndex = (a.probabilities ?? {}) as Record<string, unknown>;
        const probabilities = levels.map((_, i) => finiteOrUndefined(byIndex[String(i)]) ?? 0);
        const confidence = finiteOrUndefined(a.confidence);
        return { ok: true, value: { score, probabilities, levels, ...(confidence !== undefined ? { confidence } : {}) } };
      };
      return { ok: true, question: { type: "score", instructions, criteria: levels }, decode };
    }
    case "prob": {
      const decode: Decoder = (answer) => {
        if (answer === undefined || answer === null) return missing(key);
        const noul = finiteOrUndefined((answer as { noul?: unknown }).noul);
        if (noul === undefined) return fail(`answer "${key}" has no numeric noul`);
        return { ok: true, value: noul };
      };
      return {
        ok: true,
        question: q.criteria ? { type: "noul", instructions, criteria: q.criteria } : { type: "noul", instructions },
        decode,
      };
    }
  }
}

/** Map one schema node to a question. `path` names the node in failure reasons; `key` is the answer key. */
function questionFor(
  raw: JsonSchema,
  defs: Defs,
  path: string,
  key: string,
  context: string,
  threshold: number,
): Mapped {
  const resolved = resolve(raw, defs, path);
  if (!resolved.ok) return resolved;
  const { node, description } = resolved;
  const question = description ?? (key === "value" ? SCALAR_QUESTION : `Determine "${key}".`);
  const instructions: Instructions = context === "" ? question : { context, question };
  const decision = (node as { "x-nola-decision"?: DecisionQuestion })["x-nola-decision"];
  if (decision) return decisionQuestion(key, instructions, decision);
  if ("type" in node && node.type === "boolean") return plainNoul(key, instructions, threshold);
  if ("type" in node && node.type === "string" && node.enum) {
    return plainChoice(key, instructions, new Map(node.enum.map((label) => [label, label])));
  }
  if ("anyOf" in node && node.anyOf.length >= 2) {
    const consts = node.anyOf.map((branch) => ("const" in branch ? branch.const : undefined));
    if (consts.every((c) => typeof c === "string")) {
      return plainChoice(key, instructions, new Map(consts.map((c) => [c, c])));
    }
    if (consts.every((c) => typeof c === "number")) {
      return plainChoice(key, instructions, new Map(consts.map((c) => [String(c), c])));
    }
  }
  return fail(`${path} is ${kindOf(node)}; ${SERVES}`);
}

/** The request for an ask, or why the dialect cannot serve it. */
export function planFor(model: InferenceModel, options: { threshold: number }): PlanResult {
  const schema = model.output.syntax === "json" ? model.output.schema : undefined;
  if (!schema) return fail(`the ask has no output schema (free text); ${SERVES}`);
  const values = contextualState(model);
  const state: unknown = values ?? askText(model);
  const context = contextText(model, values !== undefined);
  const defs = "$defs" in schema ? schema.$defs : undefined;
  const root = resolve(schema, defs, "the output type");
  if (!root.ok) return root;
  const node = root.node;
  const decisionRoot = (node as { "x-nola-decision"?: DecisionQuestion })["x-nola-decision"];
  if (!decisionRoot && "type" in node && node.type === "object" && "properties" in node) {
    const questions: Record<string, DecisionWireQuestion> = {};
    const decode: Record<string, Decoder> = {};
    for (const [name, prop] of Object.entries(node.properties)) {
      const mapped = questionFor(prop, defs, `output property ${JSON.stringify(name)}`, name, context, options.threshold);
      if (!mapped.ok) return mapped;
      questions[name] = mapped.question;
      decode[name] = mapped.decode;
    }
    return { ok: true, plan: { state, questions, decode, scalar: false } };
  }
  const mapped = questionFor(schema, defs, "the output type", "value", context, options.threshold);
  if (!mapped.ok) return mapped;
  return {
    ok: true,
    plan: { state, questions: { value: mapped.question }, decode: { value: mapped.decode }, scalar: true },
  };
}
