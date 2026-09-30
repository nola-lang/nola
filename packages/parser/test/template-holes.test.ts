// biome-ignore-all lint/suspicious/noTemplateCurlyInString: .tsi fixtures contain literal ${} interpolation
import { type BaseNode, walk } from "@nola-lang/ast";
import { parseNola } from "@nola-lang/parser";
import { describe, expect, it } from "vitest";

const flaggedLiterals = (ast: BaseNode) => {
  const out: BaseNode[] = [];
  walk(ast, (n) => {
    if (n.type === "TemplateLiteral" && (n as { nolaHasScopeAccess?: boolean }).nolaHasScopeAccess) out.push(n);
  });
  return out;
};
const scopeNodes = (ast: BaseNode) => {
  const out: BaseNode[] = [];
  walk(ast, (n) => {
    if (n.type === "NolaScopeAccess") out.push(n);
  });
  return out;
};

describe("holes in instruction literals (spec 2026-09-28-instruction-interpolation §3.5)", () => {
  it("`${.member}` no longer parses: the ordinary syntax error at every instruction site, and no scope node", () => {
    for (const src of [
      "const a = ..`x ${.type}`<string>;\n",
      "infer function go(.m: string) {\n  `CONTEXT ${.signature}`\n  return m;\n}\n",
      "`${.default}`\nexport const v = ask `v`<string>;\n",
      "infer function go() {\n  const v = ask fn`${.default} once`(..`arg`<string>);\n  return v;\n}\n",
    ]) {
      const { ast, diagnostics } = parseNola(src, "x.tsi");
      expect(diagnostics.map((d) => d.code), src).toEqual(["NOLA1001"]);
      if (ast) expect(scopeNodes(ast as BaseNode), src).toHaveLength(0);
    }
  });

  it("a lexical hole in a body or module instruction parses clean and no literal is flagged", () => {
    for (const src of [
      "infer function go(n: number) {\n  `at most ${n} words`\n  return 1;\n}\n",
      "`at most ${n} words`\nconst n = 3;\nexport const v = ask `v`<string>;\n",
    ]) {
      const { ast, diagnostics } = parseNola(src, "x.tsi");
      expect(diagnostics, src).toEqual([]);
      expect(flaggedLiterals(ast as BaseNode), src).toHaveLength(0);
      expect(scopeNodes(ast as BaseNode), src).toHaveLength(0);
    }
  });

  it("outside template holes a leading dot is still an error, and `..` in a hole stays the extractor", () => {
    expect(parseNola("const a = .x;\n", "x.tsi").diagnostics.length).toBeGreaterThan(0);
    const { ast, diagnostics } = parseNola("const a = ..`p ${..`q`}`;\n", "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(scopeNodes(ast as BaseNode)).toHaveLength(0);
  });
});
