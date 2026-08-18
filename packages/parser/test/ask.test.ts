import { type BaseNode, type NolaAskExpression, sliceSpan, walk } from "@nola-lang/ast";
import { parseNola } from "@nola-lang/parser";
import { describe, expect, it } from "vitest";

function asks(ast: BaseNode): NolaAskExpression[] {
  const out: NolaAskExpression[] = [];
  walk(ast, (n) => {
    if (n.type === "NolaAskExpression") out.push(n as NolaAskExpression);
  });
  return out;
}

describe("ask operator", () => {
  it("parses `ask <extractor>` as a unary expression with exact span", () => {
    const src = "const name = ask ..`user name`<string>;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const [a] = asks(ast as BaseNode);
    expect(a).toBeDefined();
    expect(a?.argument.type).toBe("NolaExtractExpression");
    expect(sliceSpan(src, a as NolaAskExpression)).toBe("ask ..`user name`<string>");
  });

  it("parses `ask identifier` (resolving a stored intent)", () => {
    const src = "const v = ask storedIntent;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(asks(ast as BaseNode)[0]?.argument.type).toBe("Identifier");
  });

  it("works as a call argument", () => {
    const src = "log(ask ..`value`<number>);\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(asks(ast as BaseNode)).toHaveLength(1);
  });

  it("rejects `ask` as a binding name with NOLA1003", () => {
    const { ast, diagnostics } = parseNola("const ask = 1;\n", "x.tsi");
    expect(ast).toBeNull();
    expect(diagnostics[0]?.code).toBe("NOLA1003");
  });

  it("rejects `ask` as a parameter name with NOLA1003", () => {
    const { ast, diagnostics } = parseNola("function f(ask: number) {}\n", "x.tsi");
    expect(ast).toBeNull();
    expect(diagnostics[0]?.code).toBe("NOLA1003");
  });

  it("allows `ask` as a property/member name", () => {
    const src = "const o = { ask: 1 };\nconst v = o.ask;\n";
    const { diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
  });
});
