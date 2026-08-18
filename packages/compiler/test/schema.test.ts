import { type BaseNode, type NolaExtractExpression, walk } from "@nola-lang/ast";
import { collectTypeRegistry, deriveSchema } from "@nola-lang/compiler";
import { parseNola } from "@nola-lang/parser";
import { describe, expect, it } from "vitest";

/** Parse a module, return [typeArg node of first extractor, registry, source]. */
function setup(src: string): [BaseNode, Map<string, BaseNode>, string] {
  const { ast, diagnostics } = parseNola(src, "s.tsi");
  expect(diagnostics).toEqual([]);
  let t: BaseNode | undefined;
  walk(ast as BaseNode, (n) => {
    if (!t && n.type === "NolaExtractExpression") {
      const args = (n as NolaExtractExpression).typeArgs as { params?: BaseNode[] } | null;
      t = args?.params?.[0];
    }
  });
  if (!t) throw new Error("no type arg found");
  return [t, collectTypeRegistry(ast as BaseNode), src];
}

describe("deriveSchema", () => {
  it.each([
    ["const a = ..`x`<string>;", { type: "string" }],
    ["const a = ..`x`<number>;", { type: "number" }],
    ["const a = ..`x`<boolean>;", { type: "boolean" }],
    ["const a = ..`x`<string[]>;", { type: "array", items: { type: "string" } }],
  ])("derives %s", (src, expected) => {
    const [t, reg, source] = setup(src);
    expect(deriveSchema(t, source, reg)).toEqual({ ok: true, schema: expected });
  });

  it("derives inline object literals with optional fields", () => {
    const [t, reg, source] = setup("const a = ..`x`<{ x: number; y?: number }>;");
    expect(deriveSchema(t, source, reg)).toEqual({
      ok: true,
      schema: {
        type: "object",
        properties: { x: { type: "number" }, y: { type: "number" } },
        required: ["x"],
        additionalProperties: false,
      },
    });
  });

  it("derives nested objects and arrays", () => {
    const [t, reg, source] = setup("const a = ..`x`<{ tags: string[]; geo: { lat: number; lon: number } }>;");
    const r = deriveSchema(t, source, reg);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const props = (r.schema as { properties: Record<string, unknown> }).properties;
      expect(props.tags).toEqual({ type: "array", items: { type: "string" } });
      expect(props.geo).toMatchObject({ type: "object", required: ["lat", "lon"] });
    }
  });

  it("resolves same-file type aliases and interfaces", () => {
    const src = "type User = { id: string; name?: string };\nconst u = ..`user`<User>;\n";
    const [t, reg, source] = setup(src);
    const r = deriveSchema(t, source, reg);
    expect(r).toEqual({
      ok: true,
      schema: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    });

    const src2 = "interface Point { x: number; y: number }\nconst p = ..`pt`<Point>;\n";
    const [t2, reg2, source2] = setup(src2);
    expect(deriveSchema(t2, source2, reg2)).toMatchObject({
      ok: true,
      schema: { type: "object", required: ["x", "y"] },
    });
  });

  it("turns JSDoc member comments into descriptions", () => {
    const src = "type User = {\n  /** GUID */\n  id: string;\n};\nconst u = ..`user`<User>;\n";
    const [t, reg, source] = setup(src);
    const r = deriveSchema(t, source, reg);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.schema as { properties: Record<string, { description?: string }> }).properties.id?.description).toBe(
        "GUID",
      );
    }
  });

  it("derives inline string-literal unions as enum schemas", () => {
    const [t, reg, source] = setup('const a = ..`x`<"billing" | "refund" | "fraud">;');
    expect(deriveSchema(t, source, reg)).toEqual({
      ok: true,
      schema: { type: "string", enum: ["billing", "refund", "fraud"] },
    });
  });

  it("resolves same-file union aliases and dedupes labels", () => {
    const src = 'type Category = "a" | "b" | "a";\nconst c = ..`cat`<Category>;\n';
    const [t, reg, source] = setup(src);
    expect(deriveSchema(t, source, reg)).toEqual({ ok: true, schema: { type: "string", enum: ["a", "b"] } });
  });

  it("derives same-file string enums as enum schemas", () => {
    const src =
      'export enum Sentiment {\n  Positive = "positive",\n  Negative = "negative",\n}\nconst s = ..`s`<Sentiment>;\n';
    const [t, reg, source] = setup(src);
    expect(deriveSchema(t, source, reg)).toEqual({
      ok: true,
      schema: { type: "string", enum: ["positive", "negative"] },
    });
  });

  it.each([
    ['const a = ..`x`<"a" | 1>;', "mixed literal union"],
    ['const a = ..`x`<"a" | string>;', "literal plus keyword"],
    ["enum E { A, B }\nconst a = ..`x`<E>;", "numeric enum"],
  ])("rejects non-string-literal label sets: %s (%s)", (src) => {
    const [t, reg, source] = setup(src);
    expect(deriveSchema(t, source, reg).ok).toBe(false);
  });

  it.each([
    ["const a = ..`x`<string | number>;", "union"],
    ["const a = ..`x`<Map<string, number>>;", "reference"],
    ["type G<T> = { v: T };\nconst a = ..`x`<G<string>>;", "generic"],
    ["const a = ..`x`<Unknown>;", "unknown reference"],
  ])("rejects unsupported types: %s (%s)", (src) => {
    const [t, reg, source] = setup(src);
    expect(deriveSchema(t, source, reg).ok).toBe(false);
  });

  it("rejects recursive types instead of looping", () => {
    const src = "type Node2 = { next: Node2 };\nconst a = ..`x`<Node2>;";
    const [t, reg, source] = setup(src);
    expect(deriveSchema(t, source, reg).ok).toBe(false);
  });
});
