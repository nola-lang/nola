import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";

const INERT = "(undefined as never)";

describe("phase 1: accessor indirection + derivation requests (emit 15)", () => {
  it("an extractor with an inline type calls a site accessor; the request points at the lowered <T>", () => {
    const src = "export infer function f(.text: string) {\n  return ask ..`x`<{ id: string }>;\n}\n";
    const { code, meta, diagnostics } = compileNola(src, "/proj/src/m.tsi", { sourceRoot: "/proj" });
    expect(diagnostics).toEqual([]);
    expect(code).toContain("type: __nola_type_$2(), loc:");
    expect(code).toContain(
      `function __nola_type_$2(): import("@nola-lang/runtime").InferType<unknown> { return ${INERT}; }`,
    );
    expect(code).toContain(
      `function __nola_type_$1(): import("@nola-lang/runtime").InferType<unknown> | undefined { return ${INERT}; }`,
    );
    expect(code).toContain('{ name: "text", type: __nola_type_$1(), contextual: true, value: text }');
    const [ctxReq, extractReq] = meta.derivations;
    expect(ctxReq).toMatchObject({ accessor: "__nola_type_$1", kind: "context", policy: "error" });
    expect(src.slice(ctxReq?.source.start, ctxReq?.source.end)).toBe("string");
    expect(code.slice(ctxReq?.lowered.start, ctxReq?.lowered.end)).toBe("string");
    expect(extractReq).toMatchObject({ accessor: "__nola_type_$2", kind: "extract" });
    expect(code.slice(extractReq?.lowered.start, extractReq?.lowered.end)).toBe("{ id: string }");
    expect(meta.appendixStart).toBeGreaterThan(0);
    expect(code.slice(meta.appendixStart)).toMatch(/^function __nola_type_\$1/);
    expect(meta.views).toEqual([]);
  });

  it("exported types keep their named accessor (inert) and a request of kind exported; the value cast is TypeValueOf", () => {
    const { code, meta } = compileNola("export type User = { id: string };\n", "/proj/src/m.tsi", { sourceRoot: "/proj" });
    expect(code).toContain(
      `function __nola_type_User(): import("@nola-lang/runtime").InferType<unknown> { return ${INERT}; }`,
    );
    expect(code).toContain(
      'export const User = __nola_type_User() as unknown as import("@nola-lang/runtime").TypeValueOf<typeof __nola_type_User, User>;',
    );
    expect(meta.derivations).toEqual([
      expect.objectContaining({ accessor: "__nola_type_User", kind: "exported", name: "User" }),
    ]);
    const req = meta.derivations[0];
    expect(code.slice(req?.lowered.start, req?.lowered.end)).toBe("User");
  });

  it("a named extractor type still goes through a site accessor (no inline ref)", () => {
    const src = "type P = { x: number };\nconst i = ..`p`<P>;\n";
    const { code, meta } = compileNola(src, "/proj/src/m.tsi", { sourceRoot: "/proj" });
    expect(code).toContain("type: __nola_type_$1(), loc:");
    expect(code).not.toContain("__nola.types.ref(");
    expect(meta.derivations.map((d) => d.accessor)).toEqual(["__nola_type_$1"]);
    expect(code.slice(meta.derivations[0]?.lowered.start, meta.derivations[0]?.lowered.end)).toBe("P");
  });

  it("a plain (non-contextual) param annotation is a context request under the omit policy", () => {
    const src = "export infer function f(plain: Map<string, number>, .ctx: string) {\n  return ask ..`x`;\n}\n";
    const { code, meta } = compileNola(src, "/proj/src/m.tsi", { sourceRoot: "/proj", underivableContextType: "prune" });
    expect(meta.derivations.map((d) => [d.accessor, d.kind, d.policy])).toEqual([
      ["__nola_type_$1", "context", "omit"],
      ["__nola_type_$2", "context", "prune"],
    ]);
    expect(code).toContain('{ name: "plain", type: __nola_type_$1() }');
    expect(code).toContain("type: __nola.types.string(), loc:"); // the untyped extractor default stays inline
  });

  it("an untyped extractor needs no request", () => {
    const { code, meta } = compileNola("const i = ..`p`;\n", "/proj/src/m.tsi");
    expect(code).toContain("type: __nola.types.string(), loc:");
    expect(meta.derivations).toEqual([]);
  });

  it("NOLA2011 is still phase 1", () => {
    const { diagnostics } = compileNola("export type A = { x: number };\nconst A = 1;\n", "/proj/src/m.tsi");
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA2011"]);
  });

  it("no derivation site → no appendix change: appendixStart is -1 for a plain file", () => {
    const { meta, code } = compileNola("export const x = 1;\n", "/proj/src/m.tsi");
    expect(meta.appendixStart).toBe(-1);
    expect(code).toBe("export const x = 1;\n");
  });
});
