import { parseNola } from "@nola-lang/parser";
import { describe, expect, it } from "vitest";

// `1 = 2` is an invalid assignment target — Babel raises it RECOVERABLY
// (plain `this.raise`, no throw), so it exercises the errorRecovery flag
// without touching any nola plugin site.
const BROKEN = "1 = 2;\nconst ok = 3;\n";

describe("parseNola tolerant mode", () => {
  it("strict mode (default) still bails with ast: null", () => {
    const { ast, diagnostics } = parseNola(BROKEN, "t.tsi");
    expect(ast).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("NOLA1001");
  });

  it("tolerant mode returns an AST plus diagnostics", () => {
    const { ast, diagnostics } = parseNola(BROKEN, "t.tsi", { tolerant: true });
    expect(ast).not.toBeNull();
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics[0]?.code).toBe("NOLA1001");
    expect(diagnostics[0]?.file).toBe("t.tsi");
    // the valid statement after the error is present in the AST
    const program = (ast as { program?: { body?: unknown[] } }).program;
    expect((program?.body ?? []).length).toBe(2);
  });

  it("tolerant mode on valid source yields no diagnostics", () => {
    const { ast, diagnostics } = parseNola("const x = 1;\n", "t.tsi", { tolerant: true });
    expect(ast).not.toBeNull();
    expect(diagnostics).toEqual([]);
  });
});

// An expression expected at the END OF THE FILE: `<T>` after a stray `;`,
// `const x =` with nothing after it. Babel's parseExprAtom reaches
// unexpected(), which THROWS even under errorRecovery, so the whole file used
// to bail and the editor served last-good output with mappings that no longer
// matched the text (semantic tokens painted the wrong characters and the
// parse error, sitting past the old mappings' extent, was dropped). The
// recovery is TypeScript's: a missing expression, reported where it should
// have started (right after the last token, not on the trailing blank line).
describe("parseNola tolerant mode: expression expected at end of file", () => {
  it("a trailing `<T>` recovers into a placeholder with NOLA1001 right after the `>`", () => {
    const src = "const r = ask `p`;<T>\n\n";
    const { ast, diagnostics } = parseNola(src, "t.tsi", { tolerant: true });
    expect(ast).not.toBeNull();
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1001"]);
    expect(diagnostics[0]?.message).toMatch(/expression/i);
    // after `>` on the ask line — where the missing operand belongs
    expect(diagnostics[0]?.loc.start).toEqual({ line: 1, column: src.indexOf("<T>") + 3 });
    const program = (ast as { program?: { body?: Array<{ type: string; expression?: unknown }> } }).program;
    expect(program?.body?.length).toBe(2);
    const assertion = program?.body?.[1]?.expression as { type: string; expression: { nolaError?: boolean } };
    expect(assertion.type).toBe("TSTypeAssertion");
    expect(assertion.expression.nolaError).toBe(true);
  });

  it("`const x =` at end of file recovers the same way", () => {
    const { ast, diagnostics } = parseNola("const x =\n", "t.tsi", { tolerant: true });
    expect(ast).not.toBeNull();
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1001"]);
    expect(diagnostics[0]?.loc.start).toEqual({ line: 1, column: 9 });
  });

  // The same state NOT at EOF: the `;` (or a newline + statement) already
  // follows the `<T>`. The typescript mixin tries `<T>` as arrow type
  // parameters, then as a type assertion — the assertion's operand is the `;`,
  // which cannot start an expression, and the throw took the file down.
  it("`<T>;` followed by more statements recovers the same way, at the `;`", () => {
    const src = "const r = ask `p`;<T>;\nconsole.log(r);\n";
    const { ast, diagnostics } = parseNola(src, "t.tsi", { tolerant: true });
    expect(ast).not.toBeNull();
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1001"]);
    expect(diagnostics[0]?.loc.start).toEqual({ line: 1, column: src.indexOf("<T>") + 3 });
    const program = (ast as { program?: { body?: Array<{ type: string; expression?: unknown }> } }).program;
    expect(program?.body?.length).toBe(3);
    const assertion = program?.body?.[1]?.expression as { type: string; expression: { nolaError?: boolean } };
    expect(assertion.type).toBe("TSTypeAssertion");
    expect(assertion.expression.nolaError).toBe(true);
    expect(program?.body?.[2]?.type).toBe("ExpressionStatement");
  });

  it("an inline object type — `<{ name: string }>;` — recovers too (arrow type params cannot start with `{`)", () => {
    const src = "const r = ask `p`;<{ name: string }>;\n";
    const { ast, diagnostics } = parseNola(src, "t.tsi", { tolerant: true });
    expect(ast).not.toBeNull();
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1001"]);
    expect(diagnostics[0]?.loc.start).toEqual({ line: 1, column: src.indexOf(">;") + 1 });
  });

  it("`const x = ;` recovers at the `;`, and every later statement still parses", () => {
    const { ast, diagnostics } = parseNola("const x = ;\nconst y = 1;\n", "t.tsi", { tolerant: true });
    expect(ast).not.toBeNull();
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1001"]);
    expect(diagnostics[0]?.loc.start).toEqual({ line: 1, column: 9 });
    const program = (ast as { program?: { body?: Array<{ type: string }> } }).program;
    expect(program?.body?.map((s) => s.type)).toEqual(["VariableDeclaration", "VariableDeclaration"]);
  });

  it("two missing expressions in one file are two recoveries (the once-only guard is per position)", () => {
    const { ast, diagnostics } = parseNola("const a = ;\nconst b = ;\n", "t.tsi", { tolerant: true });
    expect(ast).not.toBeNull();
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1001", "NOLA1001"]);
    expect(diagnostics.map((d) => d.loc.start.line)).toEqual([1, 2]);
  });

  it("a missing operand before a closing paren — `(a + )` — recovers right after the operator", () => {
    const src = "const x = (a + );\nconst y = 1;\n";
    const { ast, diagnostics } = parseNola(src, "t.tsi", { tolerant: true });
    expect(ast).not.toBeNull();
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1001"]);
    expect(diagnostics[0]?.loc.start).toEqual({ line: 1, column: src.indexOf("+") + 1 });
    const program = (ast as { program?: { body?: Array<{ type: string }> } }).program;
    expect(program?.body?.length).toBe(2);
  });

  it("recovers ONCE: a loop that keeps asking for an expression at EOF still bails", () => {
    // an unclosed block body loops on parseStatement until `}` — without the
    // once-only guard the placeholder would be minted forever
    const { ast, diagnostics } = parseNola("function f() {\n  const x =\n", "t.tsi", { tolerant: true });
    expect(ast).toBeNull();
    expect(diagnostics).toHaveLength(1);
  });

  it("strict mode still bails", () => {
    expect(parseNola("const r = ask `p`;<T>\n", "t.tsi").ast).toBeNull();
  });
});
