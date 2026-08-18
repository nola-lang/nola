// biome-ignore-all lint/suspicious/noTemplateCurlyInString: .tsi fixtures contain literal ${} interpolation
import { type BaseNode, type NolaFunctionNode, walk } from "@nola-lang/ast";
import { parseNola } from "@nola-lang/parser";
import { describe, expect, it } from "vitest";

const scopeNodes = (ast: BaseNode) => {
  const out: BaseNode[] = [];
  walk(ast, (n) => {
    if (n.type === "NolaScopeAccess") out.push(n);
  });
  return out;
};
const inferFn = (ast: BaseNode) => {
  let fn: NolaFunctionNode | undefined;
  walk(ast, (n) => {
    if (n.type === "FunctionDeclaration" && (n as NolaFunctionNode).nolaInfer) fn = n as NolaFunctionNode;
  });
  return fn;
};
const flaggedLiterals = (ast: BaseNode) => {
  const out: BaseNode[] = [];
  walk(ast, (n) => {
    if (n.type === "TemplateLiteral" && (n as { nolaHasScopeAccess?: boolean }).nolaHasScopeAccess) out.push(n);
  });
  return out;
};

describe("${.member} scope access", () => {
  it("parses in an extractor hole and flags the literal; lexical holes do not flag", () => {
    const src = "const a = ..`x ${.type} ${y}`<string>;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const nodes = scopeNodes(ast as BaseNode);
    expect(nodes).toHaveLength(1);
    expect(src.slice(nodes[0]?.start, nodes[0]?.end)).toBe(".type");
    expect(flaggedLiterals(ast as BaseNode)).toHaveLength(1);
    const { ast: plain } = parseNola("const a = ..`x ${y}`;\n", "x.tsi");
    expect(scopeNodes(plain as BaseNode)).toHaveLength(0);
    expect(flaggedLiterals(plain as BaseNode)).toHaveLength(0);
  });

  it("continues as an ordinary member chain, including keyword members and nested holes", () => {
    const src = "const a = ..`${.args.map(a => `- ${a.name} ${.default}`)} ${.next}`;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(scopeNodes(ast as BaseNode).map((n) => src.slice(n.start, n.end)).sort()).toEqual([".args", ".default", ".next"]);
    // nested access marks EVERY enclosing literal — the outer one included
    const outerStart = src.indexOf("`");
    expect(flaggedLiterals(ast as BaseNode).some((n) => n.start === outerStart)).toBe(true);
  });

  it("an infer-function marker keeps its holes and records hasScopeAccess", () => {
    const src = "infer function go`CONTEXT ${.signature}\n${.next}`(.m: string) {\n  return m;\n}\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const fn = inferFn(ast as BaseNode);
    expect(fn?.nolaMarker?.hasScopeAccess).toBe(true);
    expect(fn?.nolaMarker?.quasi?.expressions).toHaveLength(2);
    expect(fn?.nolaMarker?.instruction).toBe("CONTEXT \n");
  });

  it("a marker with lexical-only holes parses with hasScopeAccess false", () => {
    const { ast, diagnostics } = parseNola("const G = 'g';\ninfer function go`follow ${G}`() {\n  return 1;\n}\n", "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(inferFn(ast as BaseNode)?.nolaMarker?.hasScopeAccess).toBe(false);
  });

  it("a call-intent hint accepts scope holes", () => {
    const src = "infer function go() {\n  const v = ask fn`${.default} once`(..`arg`<string>);\n  return v;\n}\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(scopeNodes(ast as BaseNode)).toHaveLength(1);
  });

  it("outside template holes a leading dot is still an error, and `..` in a hole stays the extractor", () => {
    expect(parseNola("const a = .x;\n", "x.tsi").diagnostics.length).toBeGreaterThan(0);
    const { ast, diagnostics } = parseNola("const a = ..`p ${..`q`}`;\n", "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(scopeNodes(ast as BaseNode)).toHaveLength(0);
  });

  it("NOLA1015: `${.` followed by a non-identifier — hard error strict, placeholder tolerant", () => {
    const src = "const a = ..`x ${.}`;\n";
    expect(parseNola(src, "x.tsi").diagnostics.map((d) => d.code)).toContain("NOLA1015");
    const { ast, diagnostics } = parseNola(src, "x.tsi", { tolerant: true });
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1015"]);
    const [n] = scopeNodes(ast as BaseNode);
    expect(n).toBeDefined();
    expect((n as { nolaError?: boolean }).nolaError).toBe(true);
    expect(flaggedLiterals(ast as BaseNode)).toHaveLength(1);
  });
});
