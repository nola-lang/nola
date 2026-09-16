import type { JsonSchema } from "@nola-lang/core";
import { describe, expect, it } from "vitest";
import { questionsFor } from "../src/typesafe-questions.js";

function planOf(schema: JsonSchema | undefined) {
  const r = questionsFor(schema);
  if (!r.ok) throw new Error(`expected a plan, got: ${r.reason}`);
  return r.plan;
}

describe("questionsFor — scalar roots", () => {
  it("a string enum root is one choice question keyed value, labels = the literals, decoded to the chosen label", () => {
    const plan = planOf({ type: "string", enum: ["billing", "shipping", "other"] });
    expect(plan.scalar).toBe(true);
    expect(plan.questions).toEqual({
      value: {
        type: "choice",
        instructions: "Determine the value the request asks for.",
        criteria: { billing: "billing", shipping: "shipping", other: "other" },
      },
    });
    expect(plan.decode.value?.({ type: "choice", choice: "shipping", probabilities: {}, confidence: 0.9 })).toEqual({
      ok: true,
      value: "shipping",
    });
  });

  it("a boolean root is one noul question; the decoder thresholds at 0.5", () => {
    const plan = planOf({ type: "boolean", description: "Is the customer asking for a refund?" });
    expect(plan.scalar).toBe(true);
    expect(plan.questions).toEqual({ value: { type: "noul", instructions: "Is the customer asking for a refund?" } });
    expect(plan.decode.value?.({ type: "noul", noul: 0.5 })).toEqual({ ok: true, value: true });
    expect(plan.decode.value?.({ type: "noul", noul: 0.49 })).toEqual({ ok: true, value: false });
  });

  it("a described enum uses the description as the instructions", () => {
    const plan = planOf({ type: "string", enum: ["a", "b"], description: "Which lane?" });
    expect(plan.questions.value?.instructions).toBe("Which lane?");
  });

  it("a choice decoder rejects an answer outside the labels sent, and a noul decoder rejects a non-number", () => {
    const choice = planOf({ type: "string", enum: ["a", "b"] }).decode.value;
    expect(choice?.({ type: "choice", choice: "zzz" })).toEqual({
      ok: false,
      reason: 'answer "value" chose "zzz", which is not one of the options sent',
    });
    expect(choice?.(undefined)).toEqual({ ok: false, reason: 'answer "value" is missing from the reply' });
    const noul = planOf({ type: "boolean" }).decode.value;
    expect(noul?.({ type: "noul", noul: "high" })).toEqual({ ok: false, reason: 'answer "value" has no numeric noul' });
  });
});

describe("questionsFor — object roots", () => {
  const triage: JsonSchema = {
    type: "object",
    properties: {
      department: { type: "string", enum: ["billing", "shipping"], description: "Which team owns this?" },
      urgent: { type: "boolean" },
      priority: { anyOf: [{ const: 1 }, { const: 2 }, { const: 3 }] },
      lane: { anyOf: [{ const: "fast" }, { const: "slow" }] },
    },
    required: ["department", "urgent"],
    additionalProperties: false,
  };

  it("one question per property, keyed by name; optional properties are asked too", () => {
    const plan = planOf(triage);
    expect(plan.scalar).toBe(false);
    expect(Object.keys(plan.questions)).toEqual(["department", "urgent", "priority", "lane"]);
    expect(plan.questions.department).toEqual({
      type: "choice",
      instructions: "Which team owns this?",
      criteria: { billing: "billing", shipping: "shipping" },
    });
    expect(plan.questions.urgent).toEqual({ type: "noul", instructions: 'Determine "urgent".' });
    expect(plan.questions.lane).toEqual({
      type: "choice",
      instructions: 'Determine "lane".',
      criteria: { fast: "fast", slow: "slow" },
    });
  });

  it("a numeric literal union is a choice with stringified labels, decoded back to the number", () => {
    const plan = planOf(triage);
    expect(plan.questions.priority).toEqual({
      type: "choice",
      instructions: 'Determine "priority".',
      criteria: { "1": "1", "2": "2", "3": "3" },
    });
    expect(plan.decode.priority?.({ type: "choice", choice: "2" })).toEqual({ ok: true, value: 2 });
  });

  it("resolves $ref through $defs, the referencing node's description winning", () => {
    const schema: JsonSchema = {
      $defs: { Lane: { type: "string", enum: ["fast", "slow"], description: "from the def" } },
      type: "object",
      properties: { lane: { $ref: "#/$defs/Lane", description: "from the site" }, other: { $ref: "#/$defs/Lane" } },
      required: ["lane", "other"],
      additionalProperties: false,
    };
    const plan = planOf(schema);
    expect(plan.questions.lane).toEqual({
      type: "choice",
      instructions: "from the site",
      criteria: { fast: "fast", slow: "slow" },
    });
    expect(plan.questions.other?.instructions).toBe("from the def");
  });

  it("a $ref root resolves too", () => {
    const plan = planOf({ $defs: { Yes: { type: "boolean" } }, $ref: "#/$defs/Yes" });
    expect(plan.scalar).toBe(true);
    expect(plan.questions.value?.type).toBe("noul");
  });
});

describe("questionsFor — unsupported shapes name the path", () => {
  const reasonOf = (schema: JsonSchema | undefined) => {
    const r = questionsFor(schema);
    if (r.ok) throw new Error("expected a failure");
    return r.reason;
  };
  const obj = (prop: JsonSchema): JsonSchema => ({
    type: "object",
    properties: { email: prop },
    required: ["email"],
    additionalProperties: false,
  });

  it("no schema (free text)", () => {
    expect(reasonOf(undefined)).toBe("the ask has no output schema (free text); typesafe() serves only literal unions and booleans");
  });
  it("free-form string property", () => {
    expect(reasonOf(obj({ type: "string" }))).toBe(
      'output property "email" is a free-form string; typesafe() serves only literal unions and booleans',
    );
  });
  it("date-time string (Date)", () => {
    expect(reasonOf(obj({ type: "string", format: "date-time" }))).toBe(
      'output property "email" is a date-time string; typesafe() serves only literal unions and booleans',
    );
  });
  it("number, bounded or not", () => {
    expect(reasonOf(obj({ type: "integer", minimum: 1, maximum: 5 }))).toBe(
      'output property "email" is a number; typesafe() serves only literal unions and booleans',
    );
  });
  it("array", () => {
    expect(reasonOf(obj({ type: "array", items: { type: "string", enum: ["a"] } }))).toBe(
      'output property "email" is an array; typesafe() serves only literal unions and booleans',
    );
  });
  it("nested object", () => {
    expect(reasonOf(obj({ type: "object", properties: {}, required: [], additionalProperties: false }))).toBe(
      'output property "email" is a nested object; typesafe() serves only literal unions and booleans',
    );
  });
  it("record", () => {
    expect(reasonOf({ type: "object", additionalProperties: { type: "boolean" } })).toBe(
      "the output type is a record; typesafe() serves only literal unions and booleans",
    );
  });
  it("nullable union", () => {
    expect(reasonOf(obj({ anyOf: [{ const: "a" }, { type: "null" }] }))).toBe(
      'output property "email" is a union that is not all string literals or all number literals; typesafe() serves only literal unions and booleans',
    );
  });
  it("mixed literal union", () => {
    expect(reasonOf(obj({ anyOf: [{ const: "a" }, { const: 1 }] }))).toBe(
      'output property "email" is a union that is not all string literals or all number literals; typesafe() serves only literal unions and booleans',
    );
  });
  it("single const is a one-option choice, which is pointless — unsupported", () => {
    expect(reasonOf(obj({ const: "only" }))).toBe(
      'output property "email" is a single literal; typesafe() serves only literal unions and booleans',
    );
  });
  it("unresolved $ref", () => {
    expect(reasonOf(obj({ $ref: "#/$defs/Missing" }))).toBe(
      'output property "email" is an unresolved reference "#/$defs/Missing"; typesafe() serves only literal unions and booleans',
    );
  });
  it("cyclic $ref", () => {
    const schema: JsonSchema = {
      $defs: { A: { $ref: "#/$defs/B" }, B: { $ref: "#/$defs/A" } },
      type: "object",
      properties: { email: { $ref: "#/$defs/A" } },
      required: ["email"],
      additionalProperties: false,
    };
    expect(reasonOf(schema)).toBe(
      'output property "email" is a cyclic reference "#/$defs/A"; typesafe() serves only literal unions and booleans',
    );
  });
});
