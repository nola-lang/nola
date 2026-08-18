// biome-ignore-all lint/suspicious/noTemplateCurlyInString: .tsi fixtures contain literal ${} interpolation
import { type BaseNode, type NolaExtractExpression, sliceSpan, walk } from "@nola-lang/ast";
import { parseNola } from "@nola-lang/parser";
import { describe, expect, it } from "vitest";

function extracts(ast: BaseNode): NolaExtractExpression[] {
  const out: NolaExtractExpression[] = [];
  walk(ast, (n) => {
    if (n.type === "NolaExtractExpression") out.push(n as NolaExtractExpression);
  });
  return out;
}

describe("`..` extractor", () => {
  it("parses a bare extractor as an expression with cooked prompt and exact span", () => {
    const src = "const name = ..`user name`;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const [e] = extracts(ast as BaseNode);
    expect(e).toBeDefined();
    expect(e?.prompt).toBe("user name");
    expect(e?.typeArgs).toBeNull();
    expect(sliceSpan(src, e as NolaExtractExpression)).toBe("..`user name`");
    // Babel 8 Position carries an extra `index` (byte offset); the spec's Position
    // contract is line+column, so assert that subset.
    expect(e?.loc.start).toMatchObject({ line: 1, column: 13 });
  });

  it("parses extractors in nested expression positions", () => {
    const src = "const xs = [..`first`, ..`second`];\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const found = extracts(ast as BaseNode);
    expect(found.map((e) => e.prompt)).toEqual(["first", "second"]);
  });

  it("does not break spread `...`", () => {
    const src = "const ys = [...xs, 1];\n";
    const { diagnostics, ast } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(extracts(ast as BaseNode)).toEqual([]);
  });

  it("does not break `1..toString()`", () => {
    const src = "const s = 1..toString();\n";
    const { diagnostics, ast } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(extracts(ast as BaseNode)).toEqual([]);
  });

  it("parses ${} substitutions in an extractor prompt", () => {
    const src = "const v = ..`user from ${message}`;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const found = extracts(ast as BaseNode);
    expect(found).toHaveLength(1);
    expect((found[0] as unknown as { quasi: { expressions: unknown[] } }).quasi.expressions).toHaveLength(1);
  });

  it("rejects the bare `(..)` derive-all form with NOLA1004", () => {
    const { diagnostics } = parseNola("const v = f``(..);\n", "x.tsi");
    expect(diagnostics[0]?.code).toBe("NOLA1004");
  });

  it("rejects `..` not followed by a template with NOLA1005", () => {
    const src = "const n = ..name;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(ast).toBeNull();
    expect(diagnostics[0]?.code).toBe("NOLA1005");
  });
});
