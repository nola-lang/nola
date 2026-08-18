import { type BaseNode, walk } from "@nola-lang/ast";
import { parseNola } from "@nola-lang/parser";
import { describe, expect, it } from "vitest";

function firstFn(ast: BaseNode): BaseNode | undefined {
  let found: BaseNode | undefined;
  walk(ast, (n) => {
    if (!found && (n.type === "FunctionDeclaration" || n.type === "TSDeclareFunction")) found = n;
  });
  return found;
}

describe("tolerant recovery: infer and markers", () => {
  it("infer on a generator records NOLA1004 and drops nolaInfer", () => {
    const { ast, diagnostics } = parseNola("infer function* g() {}\n", "t.tsi", { tolerant: true });
    expect(ast).not.toBeNull();
    expect(diagnostics.map((d) => d.code)).toContain("NOLA1004");
    const fn = firstFn(ast as BaseNode);
    expect(fn?.generator).toBe(true);
    expect(fn?.nolaInfer).toBeUndefined();
  });

  it("legacy marker records NOLA1007 and drops the marker", () => {
    const { ast, diagnostics } = parseNola("function f`legacy`() {}\n", "t.tsi", { tolerant: true });
    expect(ast).not.toBeNull();
    expect(diagnostics.map((d) => d.code)).toContain("NOLA1007");
    expect(firstFn(ast as BaseNode)?.nolaMarker).toBeUndefined();
  });

  it("marker substitution is legal; the cooked instruction skips the holes", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${...} in .tsi fixture source
    const src = "infer function f`a${1}b`() {}\n";
    const { ast, diagnostics } = parseNola(src, "t.tsi", { tolerant: true });
    expect(ast).not.toBeNull();
    expect(diagnostics).toEqual([]);
    const marker = firstFn(ast as BaseNode)?.nolaMarker as { instruction: string } | undefined;
    expect(marker?.instruction).toBe("ab");
  });

  it("bodiless infer records NOLA1004 and strips nola fields", () => {
    const { ast, diagnostics } = parseNola("infer function f(): void;\n", "t.tsi", { tolerant: true });
    expect(ast).not.toBeNull();
    expect(diagnostics.map((d) => d.code)).toContain("NOLA1004");
    const fn = firstFn(ast as BaseNode);
    expect(fn?.nolaInfer).toBeUndefined();
    expect(fn?.nolaMarker).toBeUndefined();
  });

  it("class-member marker records NOLA1004 and resynchronizes", () => {
    const { ast, diagnostics } = parseNola("class C { m`x`() {} }\n", "t.tsi", { tolerant: true });
    expect(ast).not.toBeNull();
    expect(diagnostics.map((d) => d.code)).toContain("NOLA1004");
  });

  it("strict mode still throws on all four", () => {
    for (const src of [
      "infer function* g() {}\n",
      "function f`legacy`() {}\n",
      "infer function f(): void;\n",
      "class C { m`x`() {} }\n",
    ]) {
      expect(parseNola(src, "t.tsi").ast).toBeNull();
    }
  });
});
