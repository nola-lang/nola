import type { JsonSchema } from "@nola-lang/core";
import { DECISION_MODEL, findDecisionQuestions, isDecisionModel, isInferModel } from "@nola-lang/core";
import { describe, expect, it } from "vitest";

describe("decision capability and dialect predicates", () => {
  it("isDecisionModel reads the brand and nothing else", () => {
    expect(isDecisionModel({ name: "x", complete: async () => ({ text: "" }), [DECISION_MODEL]: true })).toBe(true);
    expect(isDecisionModel({ name: "x", complete: async () => ({ text: "" }) })).toBe(false);
    expect(isDecisionModel(null)).toBe(false);
    expect(DECISION_MODEL).toBe(Symbol.for("nola.decisionModel"));
  });

  it("isInferModel is the method name, no brand", () => {
    expect(isInferModel({ name: "x", infer: async () => ({ text: "" }) })).toBe(true);
    expect(isInferModel({ name: "x", complete: async () => ({ text: "" }) })).toBe(false);
    expect(isInferModel(undefined)).toBe(false);
  });
});

describe("findDecisionQuestions", () => {
  const prob: JsonSchema = { type: "number", minimum: 0, maximum: 1, "x-nola-decision": { kind: "prob" } };
  const choice: JsonSchema = {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
    "x-nola-decision": { kind: "choice", criteria: { a: null, b: null } },
  };

  it("finds nothing in a plain schema", () => {
    expect(findDecisionQuestions({ type: "string" })).toEqual([]);
    expect(findDecisionQuestions(undefined)).toEqual([]);
  });

  it("finds the root and nested questions with dotted paths", () => {
    expect(findDecisionQuestions(prob)).toEqual([{ path: "", question: { kind: "prob" } }]);
    const triage: JsonSchema = {
      type: "object",
      properties: { urgent: prob, dept: choice, tags: { type: "array", items: prob } },
      required: ["urgent"],
      additionalProperties: false,
    };
    expect(findDecisionQuestions(triage).map((d) => d.path)).toEqual(["urgent", "dept", "tags[]"]);
  });

  it("walks anyOf, prefixItems, additionalProperties and $defs; does not follow $ref", () => {
    const s: JsonSchema = {
      anyOf: [prob, { type: "array", prefixItems: [prob], items: false, minItems: 1, maxItems: 1 }],
      $defs: { P: prob },
    };
    expect(findDecisionQuestions(s).map((d) => d.path)).toEqual(["anyOf[0]", "anyOf[1][0]", "$defs.P"]);
    expect(findDecisionQuestions({ type: "object", additionalProperties: prob })).toEqual([
      { path: "*", question: { kind: "prob" } },
    ]);
    expect(findDecisionQuestions({ $ref: "#/$defs/P" })).toEqual([]);
  });
});
