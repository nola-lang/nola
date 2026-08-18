// biome-ignore-all lint/suspicious/noTemplateCurlyInString: .tsi fixtures contain literal ${} interpolation
import { type BaseNode, type NolaFunctionNode, sliceSpan, walk } from "@nola-lang/ast";
import { parseNola } from "@nola-lang/parser";
import { describe, expect, it } from "vitest";

function inferFns(ast: BaseNode): NolaFunctionNode[] {
  const out: NolaFunctionNode[] = [];
  walk(ast, (n) => {
    if (n.type === "FunctionDeclaration" && n.nolaInfer) out.push(n as NolaFunctionNode);
  });
  return out;
}

describe("infer function", () => {
  it("parses an exported infer function and records the infer span", () => {
    const src = "export infer function getUser(message: string) {\n  return message;\n}\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const [fn] = inferFns(ast as BaseNode);
    expect(fn).toBeDefined();
    expect(sliceSpan(src, fn?.nolaInfer as { start: number; end: number }).trimEnd()).toBe("infer");
  });

  it("parses a non-exported infer function", () => {
    const { ast, diagnostics } = parseNola("infer function go() {\n  return 1;\n}\n", "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(inferFns(ast as BaseNode)).toHaveLength(1);
  });

  it("records the instruction marker text", () => {
    const src = "infer function getUser`extract user from message`(m: string) {\n  return m;\n}\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const [fn] = inferFns(ast as BaseNode);
    expect(fn?.nolaMarker?.instruction).toBe("extract user from message");
  });

  it("an empty marker yields an empty instruction", () => {
    const { ast } = parseNola("infer function go``() {\n  return 1;\n}\n", "x.tsi");
    expect(inferFns(ast as BaseNode)[0]?.nolaMarker?.instruction).toBe("");
  });

  it("NOLA1007: legacy marker on a non-infer function", () => {
    const { diagnostics } = parseNola("export function analyze``(x: string) {\n  return x;\n}\n", "x.tsi");
    expect(diagnostics[0]?.code).toBe("NOLA1007");
  });

  it("${} in a marker is legal (NOLA1008 retired) — the marker keeps its holes", () => {
    const { ast, diagnostics } = parseNola("infer function go`use ${db}`() {\n  return 1;\n}\n", "x.tsi");
    expect(diagnostics).toEqual([]);
    const [fn] = inferFns(ast as BaseNode);
    expect(fn?.nolaMarker?.quasi?.expressions).toHaveLength(1);
    expect(fn?.nolaMarker?.hasScopeAccess).toBe(false);
  });

  it("NOLA1004: infer generator", () => {
    const { diagnostics } = parseNola("infer function* gen() {}\n", "x.tsi");
    expect(diagnostics[0]?.code).toBe("NOLA1004");
  });

  it("NOLA1004 or NOLA1007: bodiless declare with marker", () => {
    const { diagnostics } = parseNola("declare function f``(x: string): void;\n", "x.tsi");
    // legacy marker check fires first on non-infer functions
    expect(["NOLA1004", "NOLA1007"]).toContain(diagnostics[0]?.code);
  });

  it("NOLA1004: marker on a class method", () => {
    const { diagnostics } = parseNola("class A {\n  m``() {}\n}\n", "x.tsi");
    expect(diagnostics[0]?.code).toBe("NOLA1004");
  });

  it("`infer` stays a legal identifier", () => {
    const { diagnostics } = parseNola("const infer = 1;\nconst y = infer + 1;\n", "x.tsi");
    expect(diagnostics).toEqual([]);
  });

  it("`infer` in TS conditional types is untouched", () => {
    const { diagnostics } = parseNola("type El<T> = T extends Array<infer U> ? U : never;\n", "x.tsi");
    expect(diagnostics).toEqual([]);
  });

  it("plain functions are untouched", () => {
    const { ast, diagnostics } = parseNola("function plain(a: string) {\n  return a;\n}\n", "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(inferFns(ast as BaseNode)).toHaveLength(0);
  });
});
