import { type BaseNode, walk } from "@nola-lang/ast";
import { parseNola } from "@nola-lang/parser";
import { describe, expect, it } from "vitest";

function findExtract(ast: BaseNode): BaseNode | undefined {
  let found: BaseNode | undefined;
  walk(ast, (n) => {
    if (n.type === "NolaExtractExpression") found = n;
  });
  return found;
}

describe("tolerant recovery: extract atoms", () => {
  it("bare `(..)` derive-all form records NOLA1004 and yields a placeholder", () => {
    const { ast, diagnostics } = parseNola("const r = derive(..);\n", "t.tsi", { tolerant: true });
    expect(ast).not.toBeNull();
    expect(diagnostics.map((d) => d.code)).toContain("NOLA1004");
    const node = findExtract(ast as BaseNode);
    expect(node?.nolaError).toBe(true);
    expect(node?.quasi).toBeNull();
  });

  it("`..` without a template records NOLA1005 and yields a placeholder", () => {
    const { ast, diagnostics } = parseNola("const p = ..5;\n", "t.tsi", { tolerant: true });
    expect(ast).not.toBeNull();
    expect(diagnostics.map((d) => d.code)).toContain("NOLA1005");
    const node = findExtract(ast as BaseNode);
    expect(node?.nolaError).toBe(true);
  });

  // The same half-typed state as `ask .`, one keystroke into a module-level
  // extractor. Recovery is editor-only: in a build, a lone dot is far more
  // likely a typo than a marker, and NOLA1005 would misdescribe it.
  it("a lone `.` where an extractor is being typed recovers in tolerant mode", () => {
    const { ast, diagnostics } = parseNola("const p = .\nconst q = 2;\n", "t.tsi", { tolerant: true });
    expect(ast).not.toBeNull();
    expect(diagnostics.map((d) => d.code)).toContain("NOLA1005");
    expect(findExtract(ast as BaseNode)?.nolaError).toBe(true);
  });

  it("strict mode leaves a lone `.` to the ordinary syntax error", () => {
    const { ast, diagnostics } = parseNola("const p = .\n", "t.tsi");
    expect(ast).toBeNull();
    expect(diagnostics[0]?.code).toBe("NOLA1001");
  });

  it("strict mode still throws (ast null, one diagnostic)", () => {
    const { ast, diagnostics } = parseNola("const p = ..5;\n", "t.tsi");
    expect(ast).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("NOLA1005");
  });
});
