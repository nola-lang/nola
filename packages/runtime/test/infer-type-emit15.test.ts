import { NOLA_EMIT } from "@nola-lang/core";
import { inferTypes as t } from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";

describe("emit 15 combinators", () => {
  it("NOLA_EMIT is at least 15 (the emit these combinators arrived in)", () => {
    expect(NOLA_EMIT).toBeGreaterThanOrEqual(15);
  });

  it("literal / union / nullable serialize as const / anyOf", () => {
    expect(t.literal(1).toJsonSchema()).toEqual({ const: 1 });
    expect(t.literal(true).toJsonSchema()).toEqual({ const: true });
    expect(t.union([t.string(), t.number()]).toJsonSchema()).toEqual({
      anyOf: [{ type: "string" }, { type: "number" }],
    });
    expect(t.nullable(t.string()).toJsonSchema()).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] });
  });

  it("tuple / record / object with additional", () => {
    expect(t.tuple([t.string(), t.optional(t.number())]).toJsonSchema()).toEqual({
      type: "array",
      prefixItems: [{ type: "string" }, { type: "number" }],
      items: false,
      minItems: 1,
      maxItems: 2,
    });
    expect(t.record(t.number()).toJsonSchema()).toEqual({ type: "object", additionalProperties: { type: "number" } });
    expect(t.object({ a: t.string() }, { additional: t.boolean() }).toJsonSchema()).toEqual({
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a"],
      additionalProperties: { type: "boolean" },
    });
  });

  it("old shapes are byte-identical (fingerprint invariant)", () => {
    const user = t.object({ id: t.string(), tags: t.optional(t.array(t.enum(["a", "b"]))), at: t.date() });
    expect(JSON.stringify(user.toJsonSchema())).toBe(
      '{"type":"object","properties":{"id":{"type":"string"},"tags":{"type":"array","items":{"type":"string","enum":["a","b"]}},"at":{"type":"string","format":"date-time"}},"required":["id","at"],"additionalProperties":false}',
    );
  });

  it("toTypeText / toNativeType for the new kinds", () => {
    expect(t.union([t.literal(1), t.literal(2)]).toTypeText()).toBe("1 | 2");
    expect(t.nullable(t.string()).toTypeText()).toBe("string | null");
    expect(t.tuple([t.string(), t.number()]).toTypeText()).toBe("[string, number]");
    expect(t.record(t.number()).toTypeText()).toBe("Record<string, number>");
    expect(t.union([t.object({ k: t.literal("a") }), t.object({ k: t.literal("b") })]).toTypeText()).toBe(
      '{ k: "a" } | { k: "b" }',
    );
    expect(t.record(t.number()).toNativeType()).toBe("object");
    expect(t.tuple([t.string()]).toNativeType()).toBe("array");
    expect(t.nullable(t.number()).toNativeType()).toBe("number");
    expect(t.union([t.string(), t.number()]).toNativeType()).toBe("union");
  });

  it("toJsonSchema is memoized per carrier", () => {
    const u = t.object({ a: t.string() });
    expect(u.toJsonSchema()).toBe(u.toJsonSchema());
  });
});
