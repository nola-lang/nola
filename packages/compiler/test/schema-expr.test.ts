import { collectTypeRegistry, type DeriveContext, deriveTypeExpr } from "@nola-lang/compiler";
import { parseNola } from "@nola-lang/parser";
import { describe, expect, it } from "vitest";

/** Parse a .tsi source and return (derive context, the <T> node of the first extractor). */
function setup(src: string) {
  const { ast, diagnostics } = parseNola(src, "x.tsi");
  expect(diagnostics).toEqual([]);
  if (!ast) throw new Error("parse failed");
  const ctx: DeriveContext = {
    source: src,
    registry: collectTypeRegistry(ast),
    imports: new Map(),
    importerDisplayFile: "x.tsi",
    refQualifier: "",
  };
  let typeNode: unknown;
  const walk = (n: unknown): void => {
    if (typeof n !== "object" || n === null) return;
    const node = n as { type?: string; typeArgs?: { params?: unknown[] } };
    if (node.type === "NolaExtractExpression" && node.typeArgs?.params?.[0]) typeNode = node.typeArgs.params[0];
    for (const v of Object.values(n as Record<string, unknown>)) {
      if (Array.isArray(v)) v.forEach(walk);
      else walk(v);
    }
  };
  walk(ast);
  if (!typeNode) throw new Error("no typed extractor found");
  return { ctx, typeNode: typeNode as never };
}

describe("deriveTypeExpr", () => {
  it("emits combinators for an inline object with optional + JSDoc", () => {
    const src = "const i = ..`x`<{ name: string; /** age in years */ age?: number }>;\n";
    const { ctx, typeNode } = setup(src);
    const r = deriveTypeExpr(typeNode, ctx);
    expect(r).toEqual({
      ok: true,
      expr: '__nola.types.object({ name: __nola.types.string(), age: __nola.types.optional(__nola.types.number()).describe("age in years") })',
      refs: new Set(),
      companions: new Map(),
    });
  });

  it("emits enum for string-literal unions", () => {
    const src = 'const i = ..`x`<"a" | "b" | "a">;\n';
    const { ctx, typeNode } = setup(src);
    const r = deriveTypeExpr(typeNode, ctx);
    expect(r).toEqual({ ok: true, expr: '__nola.types.enum(["a","b"])', refs: new Set(), companions: new Map() });
  });

  it("emits ref() for a registry type name and records it", () => {
    const src = "type User = { name: string };\nconst i = ..`x`<User[]>;\n";
    const { ctx, typeNode } = setup(src);
    const r = deriveTypeExpr(typeNode, ctx);
    expect(r).toEqual({
      ok: true,
      expr: '__nola.types.array(__nola.types.ref("User", __nola_type_User))',
      refs: new Set(["User"]),
      companions: new Map(),
    });
  });

  it("recursion is legal now (self-referencing type derives)", () => {
    const src = "type Node = { label: string; kids?: Node[] };\nconst i = ..`x`<Node>;\n";
    const { ctx, typeNode } = setup(src);
    const r = deriveTypeExpr(typeNode, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.expr).toBe('__nola.types.ref("Node", __nola_type_Node)');
  });

  it("still rejects unsupported types with deriveSchema's message", () => {
    const src = "const i = ..`x`<Map<string, string>>;\n";
    const { ctx, typeNode } = setup(src);
    const r = deriveTypeExpr(typeNode, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("unsupported type for intent schema");
  });

  it("an unknown name gets the guided declared-or-imported message", () => {
    const src = "const i = ..`x`<Missing>;\n";
    const { ctx, typeNode } = setup(src);
    const r = deriveTypeExpr(typeNode, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("declared in this file or imported with a named import");
  });
});
