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

describe("`..choice` / `..scale` / `..prob` sugar", () => {
  it("records the kind; the node spans from the sigil through the type argument", () => {
    const src = 'const d = ..choice`Which team?`<{ billing: "Payments"; sales: null }>;\n';
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const [e] = extracts(ast as BaseNode);
    expect(e?.kind).toBe("choice");
    expect(e?.prompt).toBe("Which team?");
    expect(e?.typeArgs?.params).toHaveLength(1);
    expect(sliceSpan(src, e as NolaExtractExpression)).toBe(
      '..choice`Which team?`<{ billing: "Payments"; sales: null }>',
    );
  });

  it("scale and prob; prob may omit the type argument", () => {
    const src = [
      'const a = ..scale`How bad?`<["low", "high"]>;',
      "const b = ..prob`Urgent?`;",
      'const c = ..prob`Urgent?`<{ true: "y"; false: "n" }>;',
      "",
    ].join("\n");
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(extracts(ast as BaseNode).map((e) => [e.kind, e.typeArgs !== null])).toEqual([
      ["scale", true],
      ["prob", false],
      ["prob", true],
    ]);
  });

  it("a plain extractor has no kind", () => {
    const { ast } = parseNola("const p = ..`q`<string>;\n", "x.tsi");
    expect(extracts(ast as BaseNode)[0]?.kind).toBeUndefined();
  });

  it("any other identifier after the sigil is NOLA1016 (strict) and recovers as a plain extractor (tolerant)", () => {
    const src = "const p = ..foo`q`<string>;\n";
    const strict = parseNola(src, "x.tsi");
    expect(strict.diagnostics.map((d) => d.code)).toEqual(["NOLA1016"]);
    const tolerant = parseNola(src, "x.tsi", { tolerant: true });
    expect(tolerant.diagnostics.map((d) => d.code)).toEqual(["NOLA1016"]);
    const [e] = extracts(tolerant.ast as BaseNode);
    expect(e?.kind).toBeUndefined();
    expect(e?.prompt).toBe("q");
    expect(e?.nolaError).toBeUndefined();
  });

  it("the sugar is not available in the implied-sigil position (that is a tagged template on an identifier)", () => {
    const src = "infer function f() {\n  return ask choice`q`<{ a: null }>;\n}\n";
    const { diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics.filter((d) => d.code === "NOLA1016")).toEqual([]);
  });
});
