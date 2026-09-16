import type { JsonSchema } from "@nola-lang/core";

/** One question as `POST /v1/systemone` takes it. Only the two primitives Nola output types can express. */
export type TypesafeQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string };

export type DecodeResult = { ok: true; value: unknown } | { ok: false; reason: string };

/** Turns the wire answer for one question into the JSON value the ask expects. */
export type Decoder = (answer: unknown) => DecodeResult;

export interface QuestionPlan {
  /** keyed by property name, or "value" for a scalar root */
  questions: Record<string, TypesafeQuestion>;
  decode: Record<string, Decoder>;
  /** true ⇔ the reply is the bare "value" answer, not an object of answers */
  scalar: boolean;
}

export type MappingResult = { ok: true; plan: QuestionPlan } | { ok: false; reason: string };

const SERVES = "typesafe() serves only literal unions and booleans";

const SCALAR_INSTRUCTIONS = "Determine the value the request asks for.";

type Mapped = { ok: true; question: TypesafeQuestion; decode: Decoder } | { ok: false; reason: string };

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

/** `labels` maps each wire label to the JSON value it stands for (the literal itself, or its number). */
function choiceQuestion(key: string, instructions: string, labels: Map<string, unknown>): Mapped {
  const criteria: Record<string, string> = {};
  for (const label of labels.keys()) criteria[label] = label;
  const decode: Decoder = (answer) => {
    if (answer === undefined || answer === null) return fail(`answer "${key}" is missing from the reply`);
    const choice = (answer as { choice?: unknown }).choice;
    if (typeof choice !== "string" || !labels.has(choice)) {
      return fail(`answer "${key}" chose ${JSON.stringify(choice)}, which is not one of the options sent`);
    }
    return { ok: true, value: labels.get(choice) };
  };
  return { ok: true, question: { type: "choice", instructions, criteria }, decode };
}

function noulQuestion(key: string, instructions: string): Mapped {
  const decode: Decoder = (answer) => {
    if (answer === undefined || answer === null) return fail(`answer "${key}" is missing from the reply`);
    const noul = (answer as { noul?: unknown }).noul;
    if (typeof noul !== "number" || Number.isNaN(noul)) return fail(`answer "${key}" has no numeric noul`);
    return { ok: true, value: noul >= 0.5 };
  };
  return { ok: true, question: { type: "noul", instructions }, decode };
}

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

/** Map one schema node to a question. `path` names the node in failure reasons; `key` is the answer key. */
function questionFor(raw: JsonSchema, defs: Defs, path: string, key: string): Mapped {
  const resolved = resolve(raw, defs, path);
  if (!resolved.ok) return resolved;
  const { node, description } = resolved;
  const instructions = description ?? (key === "value" ? SCALAR_INSTRUCTIONS : `Determine "${key}".`);
  if ("type" in node && node.type === "boolean") return noulQuestion(key, instructions);
  if ("type" in node && node.type === "string" && node.enum) {
    return choiceQuestion(key, instructions, new Map(node.enum.map((label) => [label, label])));
  }
  if ("anyOf" in node && node.anyOf.length >= 2) {
    const consts = node.anyOf.map((branch) => ("const" in branch ? branch.const : undefined));
    if (consts.every((c) => typeof c === "string")) {
      return choiceQuestion(key, instructions, new Map(consts.map((c) => [c, c])));
    }
    if (consts.every((c) => typeof c === "number")) {
      return choiceQuestion(key, instructions, new Map(consts.map((c) => [String(c), c])));
    }
  }
  return fail(`${path} is ${kindOf(node)}; ${SERVES}`);
}

/** The questions and decoders for an ask's output schema, or why Jev cannot serve it. */
export function questionsFor(schema: JsonSchema | undefined): MappingResult {
  if (!schema) return fail(`the ask has no output schema (free text); ${SERVES}`);
  const defs = "$defs" in schema ? schema.$defs : undefined;
  const root = resolve(schema, defs, "the output type");
  if (!root.ok) return root;
  const node = root.node;
  if ("type" in node && node.type === "object" && "properties" in node) {
    const questions: Record<string, TypesafeQuestion> = {};
    const decode: Record<string, Decoder> = {};
    for (const [name, prop] of Object.entries(node.properties)) {
      const mapped = questionFor(prop, defs, `output property ${JSON.stringify(name)}`, name);
      if (!mapped.ok) return mapped;
      questions[name] = mapped.question;
      decode[name] = mapped.decode;
    }
    return { ok: true, plan: { questions, decode, scalar: false } };
  }
  const mapped = questionFor(schema, defs, "the output type", "value");
  if (!mapped.ok) return mapped;
  return { ok: true, plan: { questions: { value: mapped.question }, decode: { value: mapped.decode }, scalar: true } };
}
