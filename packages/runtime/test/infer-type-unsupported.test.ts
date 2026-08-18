import { type InferType, inferTypes as t, validate } from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";

describe("__nola.types.unsupported", () => {
  it("toJsonSchema throws NOLA3009 carrying the reason", () => {
    const bad = t.unsupported("generic type 'Pick<...>' cannot be derived");
    const obj = t.object({ x: bad as unknown as InferType<unknown> });
    expect(() => obj.toJsonSchema()).toThrowError(/generic type 'Pick<\.\.\.>' cannot be derived/);
  });

  it("a bare unsupported carrier throws too (ref'd from another file)", () => {
    const thunk = () => t.unsupported("reason x") as unknown as InferType<unknown>;
    expect(() => t.ref("src/models#Weird", thunk).toJsonSchema()).toThrowError(/reason x/);
  });

  it("cross-file-style mutual recursion stays finite and validates", () => {
    // simulates two companions whose accessors reference each other; only the
    // loop-closing name becomes a $def — the other type inlines into it.
    const a = (): InferType<unknown> => t.object({ b: t.optional(t.ref("src/b#B", b)) });
    const b = (): InferType<unknown> => t.object({ a: t.optional(t.ref("src/a#A", a)) });
    const schema = t.ref("src/a#A", a).toJsonSchema();
    expect(Object.keys(schema.$defs ?? {})).toEqual(["src/a#A"]);
    expect(JSON.stringify(schema)).toContain('"#/$defs/src/a#A"');
    expect(validate(schema, { b: { a: { b: {} } } })).toEqual({ ok: true, value: { b: { a: { b: {} } } } });
  });
});
