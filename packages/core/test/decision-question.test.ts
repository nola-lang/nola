import type { DecisionQuestion, JsonSchema } from "@nola-lang/core";
import { describe, expect, it } from "vitest";

describe("DecisionQuestion on JsonSchema", () => {
  it("the three question kinds ride the x-nola-decision keyword", () => {
    const choice: DecisionQuestion = { kind: "choice", criteria: { billing: "Payments", sales: null } };
    const scale: DecisionQuestion = { kind: "scale", levels: ["Calm", "Angry"] };
    const prob: DecisionQuestion = { kind: "prob", criteria: { true: "yes", false: "no" } };
    const bare: DecisionQuestion = { kind: "prob" };
    const onNumber: JsonSchema = { type: "number", minimum: 0, maximum: 1, "x-nola-decision": prob };
    const onObject: JsonSchema = {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
      "x-nola-decision": choice,
    };
    expect([choice, scale, prob, bare, onNumber, onObject].map((x) => typeof x)).toEqual(new Array(6).fill("object"));
  });
});
