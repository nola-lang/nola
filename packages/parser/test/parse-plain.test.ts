import { type BaseNode, sliceSpan, walk } from "@nola-lang/ast";
import { parseNola } from "@nola-lang/parser";
import { describe, expect, it } from "vitest";

describe("parseNola on plain TypeScript", () => {
  it("parses a plain TS module with zero diagnostics", () => {
    const src = 'const greeting: string = "hi";\nexport function add(a: number, b: number) {\n  return a + b;\n}\n';
    const { ast, diagnostics } = parseNola(src, "plain.tsi");
    expect(diagnostics).toEqual([]);
    expect(ast).not.toBeNull();
    expect(ast?.type).toBe("File");
  });

  it("every node's span slices back to its exact source text (lossless locations)", () => {
    const src = "export function add(a: number, b: number) {\n  return a + b;\n}\n";
    const { ast } = parseNola(src, "plain.tsi");
    const checks: Array<[string, string]> = [];
    walk(ast as BaseNode, (n) => {
      if (n.type === "Identifier") checks.push([n.type, sliceSpan(src, n)]);
      if (n.type === "ReturnStatement") checks.push([n.type, sliceSpan(src, n)]);
    });
    expect(checks).toContainEqual(["Identifier", "add"]);
    expect(checks).toContainEqual(["Identifier", "a"]);
    expect(checks).toContainEqual(["ReturnStatement", "return a + b;"]);
  });

  it("returns a structured diagnostic on a syntax error, never throws", () => {
    const { ast, diagnostics } = parseNola("const = 1;", "bad.tsi");
    expect(ast).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("NOLA1001");
    expect(diagnostics[0]?.file).toBe("bad.tsi");
    expect(diagnostics[0]?.loc.start.line).toBe(1);
  });
});
