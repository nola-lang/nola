import { parseNola } from "@nola-lang/parser";
import { describe, expect, it } from "vitest";

// Babel's comment attachment (leadingComments / trailingComments /
// innerComments on every node) is off: nothing reads it — JSDoc constraints
// are read through the TypeScript checker, the lowering copies source bytes
// by span — so it is allocation and bookkeeping for no one. (Measured
// 2026-09-20 on a 320-line fixture with 200 JSDoc comments: within noise
// once the bundle's CommonJS getters were gone; it had looked like a quarter
// of the parse under them.) Should a consumer ever appear, turn it on in
// parseNola and delete this test — do not read comments off the AST while it
// is off (they are simply absent).
describe("parseNola: comments", () => {
  const src = [
    "/** the person */",
    "interface Person {",
    "  /** @minimum 0 */",
    "  age: number; // years",
    "}",
    "// ask below",
    "const p = ask `p`<Person>;",
    "",
  ].join("\n");

  it("parses a commented file cleanly", () => {
    const { ast, diagnostics } = parseNola(src, "c.tsi");
    expect(ast).not.toBeNull();
    expect(diagnostics).toEqual([]);
  });

  it("does not attach comments to nodes", () => {
    const { ast } = parseNola(src, "c.tsi");
    const body = (ast as { program: { body: Array<Record<string, unknown>> } }).program.body;
    expect(body).toHaveLength(2);
    for (const statement of body) {
      expect(statement.leadingComments).toBeUndefined();
      expect(statement.trailingComments).toBeUndefined();
    }
  });
});
