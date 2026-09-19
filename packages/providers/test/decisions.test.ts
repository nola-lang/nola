import type { InferenceScope, JsonSchema } from "@nola-lang/core";
import { describe, expect, it } from "vitest";
import { type DecisionPlan, planFor } from "../src/decisions.js";
import { modelOf } from "./helpers/model.js";

const opt = { threshold: 0.5 };
const planOf = (schema: JsonSchema | null, extra: Parameters<typeof modelOf>[0] = {}): DecisionPlan => {
  const r = planFor(modelOf({ schema, ...extra }), opt);
  if (!r.ok) throw new Error(r.reason);
  return r.plan;
};
const reasonOf = (schema: JsonSchema | null, extra: Parameters<typeof modelOf>[0] = {}): string => {
  const r = planFor(modelOf({ schema, ...extra }), opt);
  return r.ok ? "ok" : r.reason;
};

const unit: JsonSchema = { type: "number", minimum: 0, maximum: 1 };
const choiceNode: JsonSchema = {
  type: "object",
  properties: {
    choice: { type: "string", enum: ["billing", "sales"] },
    probabilities: {
      type: "object",
      properties: { billing: unit, sales: unit },
      required: ["billing", "sales"],
      additionalProperties: false,
    },
    confidence: unit,
  },
  required: ["choice", "probabilities"],
  additionalProperties: false,
  description: "Which team?",
  "x-nola-decision": { kind: "choice", criteria: { billing: "Payments", sales: null } },
};
const numericChoiceNode: JsonSchema = {
  type: "object",
  properties: {
    choice: { type: "number", enum: [1, 2] },
    probabilities: { type: "object", properties: { "1": unit, "2": unit }, required: ["1", "2"], additionalProperties: false },
    confidence: unit,
  },
  required: ["choice", "probabilities"],
  additionalProperties: false,
  "x-nola-decision": { kind: "choice", criteria: { "1": null, "2": null }, numeric: ["1", "2"] },
};
const mixedChoiceNode: JsonSchema = {
  type: "object",
  properties: {
    choice: { anyOf: [{ const: 1 }, { const: "a" }] },
    probabilities: { type: "object", properties: { "1": unit, a: unit }, required: ["1", "a"], additionalProperties: false },
    confidence: unit,
  },
  required: ["choice", "probabilities"],
  additionalProperties: false,
  "x-nola-decision": { kind: "choice", criteria: { "1": null, a: null }, numeric: ["1"] },
};
const scaleNode: JsonSchema = {
  type: "object",
  properties: {
    score: { type: "number", minimum: 0, maximum: 2 },
    probabilities: { type: "array", items: unit, minItems: 3, maxItems: 3 },
    levels: {
      type: "array",
      prefixItems: [{ const: "Calm" }, { const: "Civil" }, { const: "Angry" }],
      items: false,
      minItems: 3,
      maxItems: 3,
    },
    confidence: unit,
  },
  required: ["score", "probabilities"],
  additionalProperties: false,
  description: "How frustrated?",
  "x-nola-decision": { kind: "scale", levels: ["Calm", "Civil", "Angry"] },
};
const probNode: JsonSchema = {
  ...unit,
  description: "Urgent?",
  "x-nola-decision": { kind: "prob", criteria: { true: "yes", false: "no" } },
};
const bareProb: JsonSchema = { ...unit, "x-nola-decision": { kind: "prob" } };

const triage: JsonSchema = {
  type: "object",
  properties: {
    department: choiceNode,
    mood: scaleNode,
    urgent: probNode,
    team: { type: "string", enum: ["a", "b"], description: "Plain team" },
    priority: { anyOf: [{ const: 1 }, { const: 2 }] },
    refund: { type: "boolean" },
    maybe: bareProb,
  },
  required: ["department"],
  additionalProperties: false,
};

const scope: InferenceScope = {
  fn: "triage",
  instruction: "You triage tickets.",
  args: [
    { name: "ticket", contextual: true, value: "charged twice" },
    { name: "n", contextual: false },
  ],
  parent: {
    fn: "<module>",
    module: true,
    instruction: "Never guess.",
    args: [{ name: "ticket", contextual: true, value: "outer", local: true }],
  },
};

describe("planFor — state and context", () => {
  it("contextual values become the state (innermost wins); context = system + scopes + ask text", () => {
    const plan = planOf({ type: "boolean" }, { instruction: "Is it urgent?", system: "house rules", scope });
    expect(plan.state).toEqual({ ticket: "charged twice" });
    expect(plan.questions.value?.instructions).toEqual({
      context: "house rules\n\nNever guess.\n\nYou triage tickets.\n\nIs it urgent?",
      question: "Determine the value the request asks for.",
    });
  });

  it("no contextual value: the ask text IS the state and leaves the context", () => {
    const plan = planOf({ type: "boolean" }, { instruction: "Is it urgent?", system: "house rules" });
    expect(plan.state).toBe("Is it urgent?");
    expect(plan.questions.value?.instructions).toEqual({
      context: "house rules",
      question: "Determine the value the request asks for.",
    });
    const bare = planOf({ type: "boolean" }, { instruction: "Is it urgent?" });
    expect(bare.state).toBe("Is it urgent?");
    expect(bare.questions.value?.instructions).toBe("Determine the value the request asks for.");
  });

  it("a rendered template (input.text) wins over the raw instruction", () => {
    const model = modelOf({ schema: { type: "boolean" }, instruction: "raw" });
    model.input.text = "rendered";
    const r = planFor(model, opt);
    expect(r.ok && r.plan.state).toBe("rendered");
  });
});

describe("planFor — questions", () => {
  it("maps every kind; plain unions send null descriptions", () => {
    // no contextual value: the ask text is the state, so the questions carry only the question
    const plan = planOf(triage, { instruction: "triage" });
    expect(plan.scalar).toBe(false);
    const ctx = (question: string) => question;
    expect(plan.questions).toEqual({
      department: { type: "choice", instructions: ctx("Which team?"), criteria: { billing: "Payments", sales: null } },
      mood: { type: "score", instructions: ctx("How frustrated?"), criteria: ["Calm", "Civil", "Angry"] },
      urgent: { type: "noul", instructions: ctx("Urgent?"), criteria: { true: "yes", false: "no" } },
      team: { type: "choice", instructions: ctx("Plain team"), criteria: { a: null, b: null } },
      priority: { type: "choice", instructions: ctx('Determine "priority".'), criteria: { "1": null, "2": null } },
      refund: { type: "noul", instructions: ctx('Determine "refund".') },
      maybe: { type: "noul", instructions: ctx('Determine "maybe".') },
    });
  });

  it("scalar root: one question keyed value", () => {
    const plan = planOf({ type: "string", enum: ["x", "y"] });
    expect(plan.scalar).toBe(true);
    expect(Object.keys(plan.questions)).toEqual(["value"]);
  });

  it("$ref through $defs resolves; the first description on the chain wins", () => {
    const s: JsonSchema = {
      type: "object",
      properties: { d: { $ref: "#/$defs/D", description: "outer" } },
      required: ["d"],
      additionalProperties: false,
      $defs: { D: { type: "boolean", description: "inner" } },
    };
    expect(planOf(s).questions.d?.instructions).toBe("outer");
  });
});

describe("planFor — decode", () => {
  const plan = planOf(triage);
  const dec = (key: string, answer: unknown) => plan.decode[key]?.(answer);

  it("plain forms: the literal, the number through its const, the thresholded boolean", () => {
    expect(dec("team", { type: "choice", choice: "b", probabilities: { a: 0.2, b: 0.8 }, confidence: 0.8 })).toEqual({
      ok: true,
      value: "b",
    });
    expect(dec("priority", { type: "choice", choice: "2", probabilities: { "1": 0.3, "2": 0.7 } })).toEqual({
      ok: true,
      value: 2,
    });
    expect(dec("refund", { type: "noul", noul: 0.5 })).toEqual({ ok: true, value: false });
    expect(dec("refund", { type: "noul", noul: 0.51 })).toEqual({ ok: true, value: true });
  });

  it("Choice: the answer object, confidence only when sent", () => {
    expect(
      dec("department", {
        type: "choice",
        choice: "billing",
        probabilities: { billing: 0.9, sales: 0.1 },
        confidence: 0.9,
      }),
    ).toEqual({
      ok: true,
      value: { choice: "billing", probabilities: { billing: 0.9, sales: 0.1 }, confidence: 0.9 },
    });
    expect(dec("department", { type: "choice", choice: "sales", probabilities: { billing: 0.5, sales: 0.5 } })).toEqual({
      ok: true,
      value: { choice: "sales", probabilities: { billing: 0.5, sales: 0.5 } },
    });
    expect(dec("department", { type: "choice", choice: "nope", probabilities: {} })).toEqual({
      ok: false,
      reason: 'answer "department" chose "nope", which is not one of the options sent',
    });
    expect(dec("department", { type: "choice", choice: "billing" })).toEqual({
      ok: false,
      reason: 'answer "department" has no probabilities object',
    });
  });

  it("numeric Choice: the wire label comes back as the number", () => {
    const numeric = planOf(numericChoiceNode);
    expect(numeric.questions.value).toEqual({
      type: "choice",
      instructions: expect.anything(),
      criteria: { "1": null, "2": null },
    });
    expect(numeric.decode.value?.({ type: "choice", choice: "2", probabilities: { "1": 0.3, "2": 0.7 } })).toEqual({
      ok: true,
      value: { choice: 2, probabilities: { "1": 0.3, "2": 0.7 } },
    });
    expect(numeric.decode.value?.({ type: "choice", choice: "3", probabilities: {} })).toEqual({
      ok: false,
      reason: 'answer "value" chose "3", which is not one of the options sent',
    });
    // mixed labels: only the listed ones come back as numbers
    const mixed = planOf(mixedChoiceNode);
    expect(mixed.decode.value?.({ type: "choice", choice: "1", probabilities: { "1": 0.6, a: 0.4 } })).toMatchObject({
      value: { choice: 1 },
    });
    expect(mixed.decode.value?.({ type: "choice", choice: "a", probabilities: { "1": 0.6, a: 0.4 } })).toMatchObject({
      value: { choice: "a" },
    });
  });

  it("Scale: probabilities re-keyed from level indices to an array, levels attached", () => {
    expect(
      dec("mood", {
        type: "score",
        score: 1.3,
        probabilities: { "0": 0, "1": 0.7, "2": 0.3 },
        legend: { "0": "Calm" },
        confidence: 0.6,
      }),
    ).toEqual({
      ok: true,
      value: { score: 1.3, probabilities: [0, 0.7, 0.3], levels: ["Calm", "Civil", "Angry"], confidence: 0.6 },
    });
    expect(dec("mood", { type: "score", score: 2, probabilities: { "2": 1 } })).toEqual({
      ok: true,
      value: { score: 2, probabilities: [0, 0, 1], levels: ["Calm", "Civil", "Angry"] },
    });
    expect(dec("mood", { type: "score", probabilities: {} })).toEqual({
      ok: false,
      reason: 'answer "mood" has no numeric score',
    });
  });

  it("Prob: the noul number; missing answers are reasons", () => {
    expect(dec("urgent", { type: "noul", noul: 0.92 })).toEqual({ ok: true, value: 0.92 });
    expect(dec("maybe", { type: "noul", noul: 0 })).toEqual({ ok: true, value: 0 });
    expect(dec("urgent", undefined)).toEqual({ ok: false, reason: 'answer "urgent" is missing from the reply' });
    expect(dec("urgent", { type: "noul" })).toEqual({ ok: false, reason: 'answer "urgent" has no numeric noul' });
  });

  it("the threshold is the caller's", () => {
    const strict = planFor(modelOf({ schema: { type: "boolean" } }), { threshold: 0.8 });
    expect(strict.ok && strict.plan.decode.value?.({ type: "noul", noul: 0.79 })).toEqual({ ok: true, value: false });
    expect(strict.ok && strict.plan.decode.value?.({ type: "noul", noul: 0.81 })).toEqual({ ok: true, value: true });
  });
});

describe("planFor — unsupported shapes name the path", () => {
  const serves = "typesafe() serves Choice, Scale and Prob, literal unions and booleans";
  it.each<[string, JsonSchema | null, string]>([
    ["free string", { type: "string" }, `the output type is a free-form string; ${serves}`],
    ["date", { type: "string", format: "date-time" }, `the output type is a date-time string; ${serves}`],
    ["number", { type: "number" }, `the output type is a number; ${serves}`],
    ["array", { type: "array", items: { type: "string" } }, `the output type is an array; ${serves}`],
    [
      "nested object",
      {
        type: "object",
        properties: { a: { type: "object", properties: {}, required: [], additionalProperties: false } },
        required: [],
        additionalProperties: false,
      },
      `output property "a" is a nested object; ${serves}`,
    ],
    ["record", { type: "object", additionalProperties: { type: "string" } }, `the output type is a record; ${serves}`],
    [
      "nullable",
      { anyOf: [{ type: "string", enum: ["a"] }, { type: "null" }] },
      `the output type is a union that is not all string literals or all number literals; ${serves}`,
    ],
    ["unresolved ref", { $ref: "#/$defs/X" }, `the output type is an unresolved reference "#/$defs/X"; ${serves}`],
    ["no schema", null, `the ask has no output schema (free text); ${serves}`],
  ])("%s", (_name, schema, reason) => {
    expect(reasonOf(schema)).toBe(reason);
  });
});
