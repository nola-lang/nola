import { describe, expect, it } from "vitest";
import { inferTypes as t } from "../src/types/infer-type.js";
import type { StandardJSONSchemaV1, StandardSchemaV1 } from "../src/types/standard-schema.js";

const user = t.object({
  id: t.string(),
  role: t.enum(["admin", "member"]),
  since: t.date(),
  note: t.optional(t.string()),
});

describe("~standard.jsonSchema: Standard JSON Schema", () => {
  it("is assignable to both spec interfaces at once", () => {
    const validating: StandardSchemaV1<unknown, unknown> = user;
    const converting: StandardJSONSchemaV1<unknown, unknown> = user;
    expect(validating["~standard"].vendor).toBe("nola");
    expect(typeof converting["~standard"].jsonSchema.input).toBe("function");
    expect(typeof converting["~standard"].jsonSchema.output).toBe("function");
  });

  it("draft-2020-12 is toJsonSchema() itself, and input equals output", () => {
    const { jsonSchema } = user["~standard"];
    const input = jsonSchema.input({ target: "draft-2020-12" });
    expect(input).toBe(user.toJsonSchema());
    expect(jsonSchema.output({ target: "draft-2020-12" })).toBe(input);
  });

  it("memoizes per target", () => {
    const { jsonSchema } = user["~standard"];
    expect(jsonSchema.input({ target: "draft-07" })).toBe(jsonSchema.input({ target: "draft-07" }));
    expect(jsonSchema.input({ target: "draft-07" })).not.toBe(jsonSchema.input({ target: "openapi-3.0" }));
  });

  it("an unknown target is NOLA3017", () => {
    expect(() => user["~standard"].jsonSchema.input({ target: "draft-04" })).toThrow(/NOLA3017.*draft-04/);
  });

  it("draft-07: definitions instead of $defs, items array instead of prefixItems", () => {
    const node = t.object({ name: t.string(), children: t.array(t.ref("Node", () => node)) });
    const pair = t.tuple([t.string(), t.optional(t.number())]);
    const tree = node["~standard"].jsonSchema.input({ target: "draft-07" });
    const nodeDoc = {
      type: "object",
      properties: { name: { type: "string" }, children: { type: "array", items: { $ref: "#/definitions/Node" } } },
      required: ["name", "children"],
      additionalProperties: false,
    };
    // the anonymous root is inlined; the cyclic name lives in `definitions` (was `$defs`)
    expect(tree).toEqual({ ...nodeDoc, definitions: { Node: nodeDoc } });
    expect(JSON.stringify(tree)).not.toContain("$defs");
    expect(pair["~standard"].jsonSchema.input({ target: "draft-07" })).toEqual({
      type: "array",
      items: [{ type: "string" }, { type: "number" }],
      additionalItems: false,
      minItems: 1,
      maxItems: 2,
    });
    // untouched shapes pass through: const, anyOf, null, enum, format
    const misc = t.object({
      k: t.literal("a"),
      u: t.union([t.string(), t.number()]),
      n: t.nullable(t.date()),
      e: t.enum(["x"]),
    });
    expect(misc["~standard"].jsonSchema.input({ target: "draft-07" })).toEqual({
      type: "object",
      properties: {
        k: { const: "a" },
        u: { anyOf: [{ type: "string" }, { type: "number" }] },
        n: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
        e: { type: "string", enum: ["x"] },
      },
      required: ["k", "u", "n", "e"],
      additionalProperties: false,
    });
  });

  it("openapi-3.0: nullable flag, enum for const, items for tuples, definitions for cycles", () => {
    const shape = t.object({
      k: t.literal(1),
      n: t.nullable(t.date()),
      nu: t.nullable(t.union([t.string(), t.number()])),
      pair: t.tuple([t.string(), t.number()]),
      same: t.tuple([t.string(), t.string()]),
      d: t.string().describe("a note"),
    });
    expect(shape["~standard"].jsonSchema.output({ target: "openapi-3.0" })).toEqual({
      type: "object",
      properties: {
        k: { enum: [1] },
        n: { type: "string", format: "date-time", nullable: true },
        nu: { anyOf: [{ type: "string" }, { type: "number" }], nullable: true },
        pair: { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] }, minItems: 2, maxItems: 2 },
        same: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 },
        d: { type: "string", description: "a note" },
      },
      required: ["k", "n", "nu", "pair", "same", "d"],
      additionalProperties: false,
    });
    const node = t.object({ next: t.optional(t.ref("Node", () => node)) });
    const nodeDoc = {
      type: "object",
      properties: { next: { $ref: "#/definitions/Node" } },
      required: [],
      additionalProperties: false,
    };
    expect(node["~standard"].jsonSchema.input({ target: "openapi-3.0" })).toEqual({
      ...nodeDoc,
      definitions: { Node: nodeDoc },
    });
  });

  it("constraint keywords: exclusive bounds become boolean+minimum in openapi-3.0; integer passes everywhere", () => {
    const price = t.number().constrain({ exclusiveMinimum: 0, exclusiveMaximum: 100, multipleOf: 0.01 });
    expect(price["~standard"].jsonSchema.input({ target: "openapi-3.0" })).toEqual({
      type: "number",
      minimum: 0,
      exclusiveMinimum: true,
      maximum: 100,
      exclusiveMaximum: true,
      multipleOf: 0.01,
    });
    expect(price["~standard"].jsonSchema.input({ target: "draft-07" })).toEqual(price.toJsonSchema());
    const age = t.number().constrain({ integer: true, minimum: 13 });
    for (const target of ["draft-2020-12", "draft-07", "openapi-3.0"]) {
      expect(age["~standard"].jsonSchema.input({ target })).toEqual({ type: "integer", minimum: 13 });
    }
  });

  it("a $ref with sibling keywords is wrapped in allOf for draft-07 and openapi-3.0", () => {
    const node = t.object({ children: t.array(t.ref("Node", () => node)), tag: t.string() });
    const list = t.object({ root: t.ref("Node", () => node).constrain({}) });
    // make the ref cyclic AND constrained: an array of Node refs with minItems
    const tree = t.object({ children: t.array(t.ref("Tree", () => tree)).constrain({ minItems: 1 }) });
    expect(list.toJsonSchema()).toBeDefined();
    const d07 = tree["~standard"].jsonSchema.input({ target: "draft-07" }) as {
      properties: { children: unknown };
      definitions: Record<string, { properties: { children: unknown } }>;
    };
    expect(d07.properties.children).toEqual({ type: "array", items: { $ref: "#/definitions/Tree" }, minItems: 1 });
    const described = t.object({ next: t.ref("Described", () => described).describe("the next one") });
    const oa = described["~standard"].jsonSchema.input({ target: "openapi-3.0" }) as {
      properties: { next: unknown };
    };
    expect(oa.properties.next).toEqual({ allOf: [{ $ref: "#/definitions/Described" }], description: "the next one" });
  });

  it("conversion never mutates the 2020-12 document", () => {
    const pair = t.tuple([t.string()]);
    const before = JSON.stringify(pair.toJsonSchema());
    pair["~standard"].jsonSchema.input({ target: "draft-07" });
    pair["~standard"].jsonSchema.input({ target: "openapi-3.0" });
    expect(JSON.stringify(pair.toJsonSchema())).toBe(before);
  });
});
