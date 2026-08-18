import { canonicalize, InferType, inferTypes as t } from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";

describe("InferType.toJsonSchema", () => {
  it("serializes scalars, enums, arrays, objects, optionals, descriptions", () => {
    const schema = t
      .object({
        name: t.string().describe("full name"),
        age: t.number(),
        vip: t.boolean(),
        tags: t.array(t.string()),
        tier: t.enum(["gold", "silver"]),
        nick: t.optional(t.string()),
      })
      .toJsonSchema();
    expect(schema).toEqual({
      type: "object",
      properties: {
        name: { type: "string", description: "full name" },
        age: { type: "number" },
        vip: { type: "boolean" },
        tags: { type: "array", items: { type: "string" } },
        tier: { type: "string", enum: ["gold", "silver"] },
        nick: { type: "string" },
      },
      required: ["name", "age", "vip", "tags", "tier"],
      additionalProperties: false,
    });
  });

  it("inlines non-cyclic refs (no $defs, no $ref in the output)", () => {
    const address = () => t.object({ city: t.string() });
    const user = t.object({ home: t.ref("Address", address), work: t.ref("Address", address) });
    expect(canonicalize(user.toJsonSchema())).toBe(
      canonicalize({
        type: "object",
        properties: {
          home: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
            additionalProperties: false,
          },
          work: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
            additionalProperties: false,
          },
        },
        required: ["home", "work"],
        additionalProperties: false,
      }),
    );
  });

  it("emits $defs/$ref only for cyclic refs", () => {
    const node = (): ReturnType<typeof t.object> =>
      t.object({ label: t.string(), kids: t.optional(t.array(t.ref("Node", node))) });
    const schema = node().toJsonSchema();
    expect(schema.$defs).toBeDefined();
    expect(Object.keys(schema.$defs ?? {})).toEqual(["Node"]);
    expect(JSON.stringify(schema)).toContain('"#/$defs/Node"');
  });

  it("describe() is immutable and isInferType brands by property", () => {
    const a = t.string();
    const b = a.describe("x");
    expect(a).not.toBe(b);
    expect(a.toJsonSchema()).toEqual({ type: "string" });
    expect(InferType.isInferType(b)).toBe(true);
    expect(InferType.isInferType({ toJsonSchema() {} })).toBe(false);
  });
});
