import { describe, expect, it } from "vitest";
import { inferTypes as t } from "../src/types/infer-type.js";

describe("constrained carrier: toJsonSchema", () => {
  it("merges string keywords", () => {
    expect(t.string().constrain({ format: "email", minLength: 3, maxLength: 32, pattern: "^[a-z]+$" }).toJsonSchema()).toEqual({
      type: "string",
      format: "email",
      minLength: 3,
      maxLength: 32,
      pattern: "^[a-z]+$",
    });
  });

  it("integer replaces the number type; bounds ride along", () => {
    expect(t.number().constrain({ integer: true, minimum: 13, exclusiveMaximum: 120, multipleOf: 1 }).toJsonSchema()).toEqual({
      type: "integer",
      minimum: 13,
      exclusiveMaximum: 120,
      multipleOf: 1,
    });
    expect(t.number().constrain({ minimum: 0 }).toJsonSchema()).toEqual({ type: "number", minimum: 0 });
  });

  it("array keywords", () => {
    expect(t.array(t.string()).constrain({ minItems: 1, maxItems: 10, uniqueItems: true }).toJsonSchema()).toEqual({
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 10,
      uniqueItems: true,
    });
  });

  it("through optional: keywords on the property, required unchanged", () => {
    const shape = t.object({ a: t.optional(t.string().constrain({ minLength: 1 })), b: t.string() });
    expect(shape.toJsonSchema()).toEqual({
      type: "object",
      properties: { a: { type: "string", minLength: 1 }, b: { type: "string" } },
      required: ["b"],
      additionalProperties: false,
    });
  });

  it("through nullable: keywords go into the non-null branch", () => {
    expect(t.nullable(t.string()).constrain({ minLength: 1 }).toJsonSchema()).toEqual({
      anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
    });
  });

  it("through a non-cyclic ref the inlined schema takes them; a cyclic ref keeps them beside $ref", () => {
    const Id = t.string().constrain({ format: "uuid" });
    expect(t.ref("Id", () => Id).constrain({ minLength: 36 }).toJsonSchema()).toEqual({
      type: "string",
      format: "uuid",
      minLength: 36,
    });
    const node = t.object({ children: t.array(t.ref("Node", () => node)).constrain({ minItems: 1 }) });
    const schema = node.toJsonSchema() as { $defs: Record<string, unknown>; properties: Record<string, unknown> };
    expect(schema.properties.children).toEqual({ type: "array", items: { $ref: "#/$defs/Node" }, minItems: 1 });
  });

  it("constrain then describe keeps both; enum strings accept string keywords", () => {
    expect(t.string().constrain({ format: "email" }).describe("contact").toJsonSchema()).toEqual({
      type: "string",
      format: "email",
      description: "contact",
    });
    expect(t.enum(["a", "bb"]).constrain({ minLength: 2 }).toJsonSchema()).toEqual({
      type: "string",
      enum: ["a", "bb"],
      minLength: 2,
    });
  });

  it("toTypeText ignores constraints; toNativeType delegates", () => {
    const c = t.string().constrain({ format: "email" });
    expect(c.toTypeText()).toBe("string");
    expect(c.toNativeType()).toBe("string");
  });
});

describe("constrained carrier: validate", () => {
  const issues = (r: ReturnType<ReturnType<typeof t.string>["validate"]>) => (r.ok ? [] : r.issues.map((i) => i.message));

  it("string keywords, exact messages", () => {
    const s = t.string().constrain({ minLength: 3, maxLength: 5, pattern: "^[a-z]+$" });
    expect(issues(s.validate("a"))).toEqual(["expected at least 3 characters, got 1"]);
    expect(issues(s.validate("abcdefg"))).toEqual(["expected at most 5 characters, got 7"]);
    expect(issues(s.validate("A B"))).toEqual(['expected a string matching ^[a-z]+$, got "A B"']);
    expect(s.validate("abc")).toEqual({ ok: true, value: "abc" });
  });

  it("number keywords, exact messages", () => {
    expect(issues(t.number().constrain({ minimum: 13 }).validate(9))).toEqual(["expected a number ≥ 13, got 9"]);
    expect(issues(t.number().constrain({ maximum: 120 }).validate(130))).toEqual(["expected a number ≤ 120, got 130"]);
    expect(issues(t.number().constrain({ exclusiveMinimum: 0 }).validate(0))).toEqual(["expected a number > 0, got 0"]);
    expect(issues(t.number().constrain({ exclusiveMaximum: 1 }).validate(1))).toEqual(["expected a number < 1, got 1"]);
    expect(issues(t.number().constrain({ multipleOf: 0.01 }).validate(1.005))).toEqual(["expected a multiple of 0.01, got 1.005"]);
    expect(issues(t.number().constrain({ integer: true }).validate(1.5))).toEqual(["expected an integer, got 1.5"]);
    expect(t.number().constrain({ integer: true, minimum: 13, maximum: 120 }).validate(42)).toEqual({ ok: true, value: 42 });
  });

  it("multipleOf is exact on decimals", () => {
    const tenths = t.number().constrain({ multipleOf: 0.1 });
    expect(tenths.validate(0.3).ok).toBe(true);
    expect(tenths.validate(0.35).ok).toBe(false);
    expect(t.number().constrain({ multipleOf: 0.01 }).validate(1.15).ok).toBe(true);
  });

  it("array keywords, exact messages", () => {
    expect(issues(t.array(t.string()).constrain({ minItems: 1 }).validate([]))).toEqual(["expected at least 1 item, got 0"]);
    expect(issues(t.array(t.string()).constrain({ maxItems: 2 }).validate(["a", "b", "c"]))).toEqual([
      "expected at most 2 items, got 3",
    ]);
    expect(issues(t.array(t.object({ a: t.number() })).constrain({ uniqueItems: true }).validate([{ a: 1 }, { a: 2 }, { a: 1 }]))).toEqual([
      "expected unique items, found a duplicate at index 2",
    ]);
    expect(t.array(t.object({ a: t.number() })).constrain({ uniqueItems: true }).validate([{ a: 1 }, { a: 2 }]).ok).toBe(true);
  });

  it("every format accepts and rejects", () => {
    const cases: Array<[string, string, string]> = [
      ["date-time", "2026-01-03T00:00:00.000Z", "2026-01-03"],
      ["date", "2026-02-28", "2026-02-30"],
      ["time", "12:30:00Z", "12:30"],
      ["email", "a@b.co", "a@b"],
      ["uri", "https://nola.sh/docs", "/docs"],
      ["uuid", "123e4567-e89b-12d3-a456-426614174000", "123e4567"],
      ["ipv4", "192.168.0.1", "192.168.0.256"],
      ["ipv6", "2001:db8::1", "2001:db8::zz"],
      ["hostname", "api.nola.sh", "-bad.host"],
    ];
    for (const [format, good, bad] of cases) {
      const s = t.string().constrain({ format: format as "email" });
      expect(s.validate(good), `${format} accepts ${good}`).toEqual({ ok: true, value: good });
      expect(issues(s.validate(bad)), `${format} rejects ${bad}`).toEqual([`expected a valid ${format}, got ${JSON.stringify(bad)}`]);
    }
  });

  it("all errors: two constraints on one value, plus unrelated issues elsewhere, at their paths", () => {
    const shape = t.object({
      handle: t.string().constrain({ minLength: 3, pattern: "^[a-z]+$" }),
      age: t.number(),
    });
    const r = shape.validate({ handle: "A", age: "x" });
    expect(r.ok ? [] : r.issues).toEqual([
      { path: ["handle"], message: "expected at least 3 characters, got 1" },
      { path: ["handle"], message: 'expected a string matching ^[a-z]+$, got "A"' },
      { path: ["age"], message: "expected finite number, got string" },
    ]);
  });

  it("constraints are skipped when the inner check fails, and for null / undefined through nullable / optional", () => {
    expect(issues(t.string().constrain({ minLength: 3 }).validate(5))).toEqual(["expected string, got number"]);
    expect(t.nullable(t.string()).constrain({ minLength: 3 }).validate(null)).toEqual({ ok: true, value: null });
    expect(issues(t.nullable(t.string()).constrain({ minLength: 3 }).validate("a"))).toEqual(["expected at least 3 characters, got 1"]);
    const shape = t.object({ a: t.optional(t.string().constrain({ minLength: 3 })) });
    expect(shape.validate({})).toEqual({ ok: true, value: {} });
  });

  it("parse reports constraint issues under NOLA3016", () => {
    expect(() => t.string().constrain({ format: "email" }).parse("nope")).toThrow(/NOLA3016.*expected a valid email/);
  });
});
