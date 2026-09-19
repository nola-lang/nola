import { inferTypes as t } from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";

const unit = { type: "number", minimum: 0, maximum: 1 };

describe("decision schemas", () => {
  it("choice: the answer object's structural schema plus the question", () => {
    expect(t.choice({ billing: "Payments", sales: null }).describe("Which team?").toJsonSchema()).toEqual({
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
    });
  });

  it("scale: score bounds, n probabilities, the levels as constants", () => {
    expect(t.scale(["Calm", "Angry"]).toJsonSchema()).toEqual({
      type: "object",
      properties: {
        score: { type: "number", minimum: 0, maximum: 1 },
        probabilities: { type: "array", items: unit, minItems: 2, maxItems: 2 },
        levels: {
          type: "array",
          prefixItems: [{ const: "Calm" }, { const: "Angry" }],
          items: false,
          minItems: 2,
          maxItems: 2,
        },
        confidence: unit,
      },
      required: ["score", "probabilities"],
      additionalProperties: false,
      "x-nola-decision": { kind: "scale", levels: ["Calm", "Angry"] },
    });
  });

  it("prob: a unit number carrying the criteria (or none)", () => {
    expect(t.prob({ true: "y", false: "n" }).toJsonSchema()).toEqual({
      ...unit,
      "x-nola-decision": { kind: "prob", criteria: { true: "y", false: "n" } },
    });
    expect(t.prob().toJsonSchema()).toEqual({ ...unit, "x-nola-decision": { kind: "prob" } });
  });

  it("the keyword survives the draft-07 and openapi-3.0 rewrites, nested in an object", () => {
    const triage = t.object({ urgent: t.prob(), mood: t.scale(["a", "b"]) });
    for (const target of ["draft-07", "openapi-3.0"] as const) {
      const doc = triage["~standard"].jsonSchema.output({ target }) as {
        properties: Record<string, Record<string, unknown>>;
      };
      expect(doc.properties.urgent?.["x-nola-decision"]).toEqual({ kind: "prob" });
      expect(doc.properties.mood?.["x-nola-decision"]).toEqual({ kind: "scale", levels: ["a", "b"] });
    }
  });

  it("numeric labels: choice is a number enum and the question lists the number labels", () => {
    const doc = t.choice({ "1": null, "2": null }, { numeric: ["1", "2"] }).toJsonSchema() as {
      properties: Record<string, unknown>;
      "x-nola-decision": unknown;
    };
    expect(doc.properties.choice).toEqual({ type: "number", enum: [1, 2] });
    expect(doc.properties.probabilities).toEqual({
      type: "object",
      properties: { "1": unit, "2": unit },
      required: ["1", "2"],
      additionalProperties: false,
    });
    expect(doc["x-nola-decision"]).toEqual({ kind: "choice", criteria: { "1": null, "2": null }, numeric: ["1", "2"] });
  });

  it("mixed labels: choice is a union of consts", () => {
    const doc = t.choice({ "1": null, a: null }, { numeric: ["1"] }).toJsonSchema() as { properties: Record<string, unknown> };
    expect(doc.properties.choice).toEqual({ anyOf: [{ const: 1 }, { const: "a" }] });
  });

  it("the canonical schema is memoized like every other node", () => {
    const c = t.choice({ a: null, b: null });
    expect(c.toJsonSchema()).toBe(c.toJsonSchema());
  });
});
