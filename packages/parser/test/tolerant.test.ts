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
