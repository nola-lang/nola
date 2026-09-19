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

  it("a template directly after `ask` is an extractor (the `..` is implied)", () => {
    const src = "const name = ask `user name`<string>;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const [a] = asks(ast as BaseNode);
    expect(a?.argument.type).toBe("NolaExtractExpression");
    const e = a?.argument as unknown as { prompt: string; typeArgs: unknown; start: number; quasi: { start: number } };
    expect(e.prompt).toBe("user name");
    expect(e.typeArgs).not.toBeNull();
    expect(e.start).toBe(e.quasi.start); // span begins at the backtick
    expect(sliceSpan(src, a as NolaAskExpression)).toBe("ask `user name`<string>");
  });

  it("the implied form takes an untyped template and interpolation holes", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${...} in .tsi fixture source
    const src = "const v = ask `user from ${message}`;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const e = asks(ast as BaseNode)[0]?.argument as unknown as {
      type: string;
      typeArgs: unknown;
      quasi: { expressions: unknown[] };
    };
    expect(e.type).toBe("NolaExtractExpression");
    expect(e.typeArgs).toBeNull();
    expect(e.quasi.expressions).toHaveLength(1);
  });

  it("subscripts after the implied extractor attach to the extractor", () => {
    const src = "const v = ask `x`<string>.withRetry(2);\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const arg = asks(ast as BaseNode)[0]?.argument as unknown as { type: string; callee: { object: { type: string } } };
    expect(arg.type).toBe("CallExpression");
    expect(arg.callee.object.type).toBe("NolaExtractExpression");
  });

  it("the implied form needs whitespace before the template: `ask`x`` is NOLA1017", () => {
    for (const src of ["const a = ask`x`<string>;\n", "const b = ask with fast`x`<string>;\n"]) {
      const strict = parseNola(src, "x.tsi");
      expect(strict.diagnostics.map((d) => d.code)).toEqual(["NOLA1017"]);
      // tolerant: the diagnostic is recorded and the operand still parses as the extractor
      const tolerant = parseNola(src, "x.tsi", { tolerant: true });
      expect(tolerant.diagnostics.map((d) => d.code)).toEqual(["NOLA1017"]);
      expect(asks(tolerant.ast as BaseNode)[0]?.argument.type).toBe("NolaExtractExpression");
    }
    // the diagnostic sits at the backtick
    const { diagnostics } = parseNola("const a = ask`x`<string>;\n", "x.tsi");
    expect(diagnostics[0]?.loc.start).toMatchObject({ line: 1, column: 13 });
  });

  it("any whitespace separates: several spaces, a tab, a newline", () => {
    for (const src of ["const a = ask  `x`;\n", "const a = ask\t`x`;\n", "const a = ask\n  `x`;\n"]) {
      const { ast, diagnostics } = parseNola(src, "x.tsi");
      expect(diagnostics).toEqual([]);
      expect(asks(ast as BaseNode)[0]?.argument.type).toBe("NolaExtractExpression");
    }
  });

  it("a parenthesized or tagged template after `ask` stays a plain expression", () => {
    for (const src of ["const a = ask (`x`);\n", "const b = ask tag`x`;\n"]) {
      const { ast, diagnostics } = parseNola(src, "x.tsi");
      expect(diagnostics).toEqual([]);
      expect(asks(ast as BaseNode)[0]?.argument.type).not.toBe("NolaExtractExpression");
    }
  });
});
