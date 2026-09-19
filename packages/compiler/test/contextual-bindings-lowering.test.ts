// biome-ignore-all lint/suspicious/noTemplateCurlyInString: .tsi fixtures and lowered output contain literal ${} interpolation
import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";
import { typecheckLowered } from "./helpers/typecheck.js";

describe("contextual bindings lowering (scope-bodies spec §2.2 / §5.2)", () => {
  it("infer body: the binding's marker goes, the ask lists it, the func init declares it", () => {
    const src = [
      "infer function go(.q: string) {",
      '  const .tone = "brief";',
      "  const v = ask ..`v`<string>;",
      "  return v;",
      "}",
      "",
    ].join("\n");
    const { code, diagnostics, meta } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain('  const tone = "brief";');
    expect(code).toContain("}), __frame, undefined, { tone });");
    expect(code).toContain(
      'args: [{ name: "q", type: __nola_type_$1(), contextual: true, value: q }], locals: [{ name: "tone" }] }));',
    );
    // the marker is a replaced span, never a broken one — the binding is legal
    expect(meta.spans.filter((s) => s.kind === "broken")).toEqual([]);
    expect(typecheckLowered({ "x.ts": code })).toEqual([]);
  });

  it("module body: the same shape against the module accessor", () => {
    const src = ['const .tone = "brief";', "export const v = ask ..`v`<string>;", ""].join("\n");
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain('const tone = "brief";');
    expect(code).toContain("}), __nola_module_ctx(), undefined, { tone });");
    expect(code).toContain('function __nola_module_ctx() { return __nola_file_ctx().module({ locals: [{ name: "tone" }] }); }');
    expect(typecheckLowered({ "x.ts": code })).toEqual([]);
  });

  it("an annotated binding gets a context-kind derivation request under the configured policy", () => {
    const src = ["type User = { id: string };", "const .user: User = { id: 'u1' };", "const v = ask ..`v`<string>;", ""].join(
      "\n",
    );
    const { code, diagnostics, meta } = compileNola(src, "x.tsi", { underivableContextType: "prune" });
    expect(diagnostics).toEqual([]);
    expect(code).toContain('locals: [{ name: "user", type: __nola_type_$1() }]');
    const req = meta.derivations.find((d) => d.accessor === "__nola_type_$1");
    expect(req).toMatchObject({ kind: "context", policy: "prune" });
    expect(src.slice(req?.source.start, req?.source.end)).toBe("User");
    expect(code.slice(req?.lowered.start, req?.lowered.end)).toBe("User");
  });

  it("visibility is lexical: only bindings declared before the ask, in an enclosing block", () => {
    const src = [
      "const .a = 1;",
      "const first = ask ..`f`<string>;",
      "{",
      "  const .b = 2;",
      "  const second = ask ..`s`<string>;",
      "}",
      "for (const .m of ['x']) {",
      "  const third = ask ..`t`<string>;",
      "}",
      "let .c = 3;",
      "c = 4;",
      "const fourth = ask ..`u`<string>;",
      "",
    ].join("\n");
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const closes = [...code.matchAll(/__nola_module_ctx\(\)(, undefined, \{[^}]*\})?\);/g)].map((m) => m[1] ?? "");
    expect(closes).toEqual([", undefined, { a }", ", undefined, { a, b }", ", undefined, { a, m }", ", undefined, { a, c }"]);
    expect(code).toContain('locals: [{ name: "a" }, { name: "b" }, { name: "m" }, { name: "c" }]');
    expect(typecheckLowered({ "x.ts": code })).toEqual([]);
  });

  it("the ask-with alias and locals share the argument list", () => {
    const src = ['const .tone = "brief";', "export const v = ask with fast ..`v`<string>;", ""].join("\n");
    const { code } = compileNola(src, "x.tsi");
    expect(code).toContain('}), __nola_module_ctx(), "fast", { tone });');
  });

  it("a body's own binding does not leak into another body", () => {
    const src = [
      'const .tone = "brief";',
      "infer function go() {",
      '  const .mood = "calm";',
      "  return ask ..`v`<string>;",
      "}",
      "const v = ask go();",
      "",
    ].join("\n");
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain("}), __frame, undefined, { mood });");
    expect(code).toContain("const v = await __nola.ask(go(), __nola_module_ctx(), undefined, { tone });");
    expect(code).toContain('locals: [{ name: "mood" }] }));');
    expect(code).toContain('module({ locals: [{ name: "tone" }] })');
  });

  it("NOLA1010: a contextual binding outside a scope body", () => {
    const src = 'async function plain() {\n  const .tone = "brief";\n  return tone;\n}\n';
    const { diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1010"]);
  });

  it("an ask with no visible binding keeps the two-argument close, byte for byte", () => {
    const src = "const v = ask ..`v`<string>;\nconst .late = 1;\n";
    const { code } = compileNola(src, "x.tsi");
    expect(code).toContain("}), __nola_module_ctx());");
    expect(code).toContain('module({ locals: [{ name: "late" }] })');
  });
});
