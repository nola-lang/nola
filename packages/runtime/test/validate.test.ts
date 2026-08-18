import type { JsonSchema } from "@nola-lang/core";
import { validate } from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";

const user: JsonSchema = {
  type: "object",
  properties: { id: { type: "string" }, name: { type: "string" }, age: { type: "number" } },
  required: ["id"],
  additionalProperties: false,
};

describe("validate", () => {
  it.each([
    [{ type: "string" } as JsonSchema, "hi", true],
    [{ type: "string" } as JsonSchema, 5, false],
    [{ type: "number" } as JsonSchema, 3.5, true],
    [{ type: "number" } as JsonSchema, Number.NaN, false],
    [{ type: "boolean" } as JsonSchema, true, true],
    [{ type: "boolean" } as JsonSchema, "true", false],
    [{ type: "array", items: { type: "number" } } as JsonSchema, [1, 2], true],
    [{ type: "array", items: { type: "number" } } as JsonSchema, [1, "2"], false],
  ])("scalar/array case %#", (schema, value, ok) => {
    expect(validate(schema, value).ok).toBe(ok);
  });

  it("accepts objects with required present, optionals absent", () => {
    expect(validate(user, { id: "a" }).ok).toBe(true);
    expect(validate(user, { id: "a", name: "n", age: 3 }).ok).toBe(true);
  });

  it("rejects missing required, unknown keys, null-for-optional", () => {
    expect(validate(user, { name: "n" })).toMatchObject({ ok: false, error: expect.stringContaining("id") });
    expect(validate(user, { id: "a", extra: 1 })).toMatchObject({ ok: false, error: expect.stringContaining("extra") });
    expect(validate(user, { id: "a", name: null }).ok).toBe(false);
  });

  it("reports a path in nested errors", () => {
    const nested: JsonSchema = {
      type: "object",
      properties: {
        geo: {
          type: "object",
          properties: { lat: { type: "number" } },
          required: ["lat"],
          additionalProperties: false,
        },
      },
      required: ["geo"],
      additionalProperties: false,
    };
    const r = validate(nested, { geo: { lat: "x" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("$.geo.lat");
  });

  it("checks enum membership on string schemas", () => {
    const schema: JsonSchema = { type: "string", enum: ["billing", "refund"] };
    expect(validate(schema, "billing")).toEqual({ ok: true, value: "billing" });
    const r = validate(schema, "fraud");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('"billing"');
      expect(r.error).toContain('"refund"');
    }
    expect(validate(schema, 5).ok).toBe(false);
  });

  it("returns the value on success", () => {
    const r = validate({ type: "string" }, "v");
    expect(r).toEqual({ ok: true, value: "v" });
  });
});
