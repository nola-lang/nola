import { type BaseNode, walk } from "@nola-lang/ast";
import { parseNola } from "@nola-lang/parser";
import { describe, expect, it } from "vitest";

describe("tolerant recovery: ask", () => {
  it("`ask with <non-name>` degrades to a plain ask with NOLA1009", () => {
    const src = "infer function go(input: string) {\n  return ask with (input);\n}\n";
    const { ast, diagnostics } = parseNola(src, "t.tsi", { tolerant: true });
    expect(ast).not.toBeNull();
    expect(diagnostics.map((d) => d.code)).toContain("NOLA1009");
    let askNode: BaseNode | undefined;
    walk(ast as BaseNode, (n) => {
      if (n.type === "NolaAskExpression") askNode = n;
    });
    expect(askNode).toBeDefined();
    expect(askNode?.provider).toBeNull();
  });

  it("`ask` as a binding degrades to an identifier with NOLA1003", () => {
    const { ast, diagnostics } = parseNola("const ask = 1;\n", "t.tsi", { tolerant: true });
    expect(ast).not.toBeNull();
    expect(diagnostics.map((d) => d.code)).toContain("NOLA1003");
    const program = (ast as { program?: { body?: BaseNode[] } }).program;
    expect(program?.body?.[0]?.type).toBe("VariableDeclaration");
  });

  // Mid-typing `ask ..`: after the FIRST dot the operand is a lone `.`, which
  // Babel's expression atom cannot recover from (unexpected() throws even under
  // errorRecovery). Without this the whole file bails and the editor serves
  // stale lowered output — which is where the bogus completion popup came from.
  it("`ask .` (half-typed marker) recovers as a broken extract placeholder", () => {
    const src = "infer function go() {\n  const x = ask .\n  return x;\n}\n";
    const { ast, diagnostics } = parseNola(src, "t.tsi", { tolerant: true });
    expect(ast).not.toBeNull();
    expect(diagnostics.map((d) => d.code)).toContain("NOLA1005");
    let extract: BaseNode | undefined;
    walk(ast as BaseNode, (n) => {
      if (n.type === "NolaExtractExpression") extract = n;
    });
    expect(extract?.nolaError).toBe(true);
    // the dot is consumed by the placeholder, so the rest of the body parses
    let askNode: BaseNode | undefined;
    walk(ast as BaseNode, (n) => {
      if (n.type === "NolaAskExpression") askNode = n;
    });
    expect(askNode?.argument).toBe(extract);
  });

  it("strict mode still throws on both", () => {
    expect(parseNola("const ask = 1;\n", "t.tsi").ast).toBeNull();
    expect(parseNola("infer function go() {\n  return ask with (1);\n}\n", "t.tsi").ast).toBeNull();
  });
});
