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

describe("ask with <identifier> (provider alias)", () => {
  it("parses `ask with fast <extractor>` and records the alias with its span", () => {
    const src = "const name = ask with fast ..`user name`<string>;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const [a] = asks(ast as BaseNode);
    expect(a).toBeDefined();
    expect(a?.provider?.name).toBe("fast");
    expect(sliceSpan(src, a?.provider as { start: number; end: number })).toBe("fast");
    expect(a?.argument.type).toBe("NolaExtractExpression");
    expect(sliceSpan(src, a as NolaAskExpression)).toBe("ask with fast ..`user name`<string>");
  });

  it("parses `ask with fast storedIntent` (alias then identifier operand)", () => {
    const src = "const v = ask with fast storedIntent;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const [a] = asks(ast as BaseNode);
    expect(a?.provider?.name).toBe("fast");
    expect(a?.argument.type).toBe("Identifier");
  });

  it("parses `ask with default` — the one provider name every config has is a JS keyword", () => {
    const src = "const name = ask with default ..`user name`<string>;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const [a] = asks(ast as BaseNode);
    expect(a?.provider?.name).toBe("default");
    expect(sliceSpan(src, a?.provider as { start: number; end: number })).toBe("default");
    expect(a?.argument.type).toBe("NolaExtractExpression");
  });

  it("accepts any keyword-named alias (config keys are arbitrary strings)", () => {
    const { ast, diagnostics } = parseNola("const v = ask with new storedIntent;\n", "x.tsi");
    expect(diagnostics).toEqual([]);
    const [a] = asks(ast as BaseNode);
    expect(a?.provider?.name).toBe("new");
    expect(a?.argument.type).toBe("Identifier");
  });

  it("leaves provider null on a plain `ask`", () => {
    const src = "const v = ask ..`value`<number>;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(asks(ast as BaseNode)[0]?.provider).toBeNull();
  });

  it("does not confuse an operand starting with `with...` for an alias", () => {
    const src = "const v = ask withoutDoubt;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const [a] = asks(ast as BaseNode);
    expect(a?.provider).toBeNull();
    expect((a?.argument as BaseNode & { name?: string }).name).toBe("withoutDoubt");
  });

  it("rejects `ask with <extractor>` (missing alias) with NOLA1009", () => {
    const { ast, diagnostics } = parseNola("const v = ask with ..`x`;\n", "x.tsi");
    expect(ast).toBeNull();
    expect(diagnostics[0]?.code).toBe("NOLA1009");
  });

  it("rejects the dynamic form `ask with (expr)` with NOLA1009", () => {
    const { ast, diagnostics } = parseNola("const v = ask with (p) intent;\n", "x.tsi");
    expect(ast).toBeNull();
    expect(diagnostics[0]?.code).toBe("NOLA1009");
  });

  it("rejects a non-identifier alias `ask with 123` with NOLA1009", () => {
    const { ast, diagnostics } = parseNola("const v = ask with 123 intent;\n", "x.tsi");
    expect(ast).toBeNull();
    expect(diagnostics[0]?.code).toBe("NOLA1009");
  });
});
