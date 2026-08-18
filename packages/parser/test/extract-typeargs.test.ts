import { type BaseNode, type NolaExtractExpression, sliceSpan, walk } from "@nola-lang/ast";
import { parseNola } from "@nola-lang/parser";
import { describe, expect, it } from "vitest";

function firstExtract(ast: BaseNode): NolaExtractExpression {
  let found: NolaExtractExpression | undefined;
  walk(ast, (n) => {
    if (!found && n.type === "NolaExtractExpression") found = n as NolaExtractExpression;
  });
  if (!found) throw new Error("no NolaExtractExpression in AST");
  return found;
}

describe("extractor postfix type args", () => {
  it("parses a scalar type arg and spans include it", () => {
    const src = "const id = ..`ticket id`<string>;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const e = firstExtract(ast as BaseNode);
    expect(e.typeArgs).not.toBeNull();
    expect(sliceSpan(src, e)).toBe("..`ticket id`<string>");
    const param = (e.typeArgs as unknown as { params: BaseNode[] }).params[0];
    expect(param?.type).toBe("TSStringKeyword");
  });

  it("parses array and inline object type args", () => {
    const src = "const a = ..`tags`<string[]>;\nconst b = ..`point`<{ x: number; y?: number }>;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const all: NolaExtractExpression[] = [];
    walk(ast as BaseNode, (n) => {
      if (n.type === "NolaExtractExpression") all.push(n as NolaExtractExpression);
    });
    const [a, b] = all;
    expect((a?.typeArgs as unknown as { params: BaseNode[] }).params[0]?.type).toBe("TSArrayType");
    expect((b?.typeArgs as unknown as { params: BaseNode[] }).params[0]?.type).toBe("TSTypeLiteral");
  });

  it("parses a type-reference arg (same-file alias)", () => {
    const src = "type User = { id: string };\nconst u = ..`user`<User>;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const e = firstExtract(ast as BaseNode);
    expect((e.typeArgs as unknown as { params: BaseNode[] }).params[0]?.type).toBe("TSTypeReference");
  });

  it("parenthesized extractor allows comparison (escape hatch)", () => {
    const src = "const c = (..`n`) < x;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    let sawBinary = false;
    walk(ast as BaseNode, (n) => {
      if (n.type === "BinaryExpression") sawBinary = true;
    });
    expect(sawBinary).toBe(true);
  });
});
