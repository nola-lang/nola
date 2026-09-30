import { type BaseNode, type NolaAskExpression, type NolaExtractExpression, sliceSpan, walk } from "@nola-lang/ast";
import { parseNola } from "@nola-lang/parser";
import { describe, expect, it } from "vitest";

// walk() is breadth-first; sort into source order so multi-statement fixtures read top to bottom.
function nodes(ast: BaseNode, type: string): BaseNode[] {
  const out: BaseNode[] = [];
  walk(ast, (n) => {
    if (n.type === type) out.push(n);
  });
  return out.sort((a, b) => a.start - b.start);
}

const extracts = (ast: BaseNode) => nodes(ast, "NolaExtractExpression") as NolaExtractExpression[];
const asks = (ast: BaseNode) => nodes(ast, "NolaAskExpression") as NolaAskExpression[];
const calls = (ast: BaseNode) => nodes(ast, "CallExpression") as Array<BaseNode & { arguments: BaseNode[] }>;
const typeOf = (e: NolaExtractExpression | undefined) =>
  (e?.typeArgs as unknown as { params: BaseNode[] } | null | undefined)?.params[0];

// Implied sigil in call slots (spec 2026-09-30): a typed template literal that
// is an argument's first token is an extractor — the `..` is implied in a
// call's argument list as it is directly after `ask` — and so is one nested
// in plain object/array literals there, the slot positions of the sigil-less
// call-intent rule.
describe("implied extractor sigil in call slots", () => {
  it("a typed template as a direct argument is an extractor, both spellings", () => {
    for (const [src, type] of [
      ["const id = ask createTicket(`a short ticket title`: string, 2);\n", "TSStringKeyword"],
      ["const id = ask createTicket(`a short ticket title`<string>, 2);\n", "TSStringKeyword"],
    ] as const) {
      const { ast, diagnostics } = parseNola(src, "x.tsi");
      expect(diagnostics).toEqual([]);
      const [e] = extracts(ast as BaseNode);
      expect(typeOf(e)?.type).toBe(type);
      expect(e?.start).toBe(e?.quasi?.start); // the span begins at the backtick
      expect(e?.prompt).toBe("a short ticket title");
      const [call] = calls(ast as BaseNode);
      expect(call?.arguments[0]).toBe(e);
      expect(call?.arguments[1]?.type).toBe("NumericLiteral");
      expect(asks(ast as BaseNode)[0]?.argument).toBe(call);
    }
    const src = "const id = ask createTicket(`a short ticket title`: string, 2);\n";
    const { ast } = parseNola(src, "x.tsi");
    expect(sliceSpan(src, extracts(ast as BaseNode)[0] as BaseNode)).toBe("`a short ticket title`: string");
  });

  it("works without `ask` (a stored call intent), in any argument position and across lines", () => {
    const src = [
      "const t = createTicket(",
      "  `a short ticket title`: string,",
      "  `priority 1-5`: number,",
      ");",
      "const u = f(1, `x`: string, g());",
      "",
    ].join("\n");
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const all = extracts(ast as BaseNode);
    expect(all.map((e) => typeOf(e)?.type)).toEqual(["TSStringKeyword", "TSNumberKeyword", "TSStringKeyword"]);
    expect(calls(ast as BaseNode).map((c) => c.arguments.length)).toEqual([2, 3, 0]);
  });

  it("holes, `..` in a slot and `ask` in a slot keep their meaning", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${...} in .tsi fixture source
    const src = "const a = f(`x ${y}`: string);\nconst b = f(..`x`: string);\nconst c = g(ask `x`: string);\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const all = extracts(ast as BaseNode);
    expect(all).toHaveLength(3);
    expect(all[0]?.quasi?.expressions).toHaveLength(1);
    expect(sliceSpan(src, all[1] as BaseNode)).toBe("..`x`: string"); // the dots stay part of the node
    expect(asks(ast as BaseNode)[0]?.argument).toBe(all[2]);
  });

  it("a slot nested in plain object and array literals inside the arguments", () => {
    const src = [
      "const a = api.save({ qty: 1, note: `a one-line note`: string });",
      "const b = f([`x`: string, 2]);",
      "const c = f({ items: [{ name: `the name`<string> }] });",
      "",
    ].join("\n");
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(extracts(ast as BaseNode).map((e) => e.prompt)).toEqual(["a one-line note", "x", "the name"]);
  });

  it("subscripts after the extractor attach to it", () => {
    for (const src of ["f(`x`<string>.withRetry(2));\n", "f(`x`: string[].withRetry(2));\n"]) {
      const { ast, diagnostics } = parseNola(src, "x.tsi");
      expect(diagnostics).toEqual([]);
      const outer = calls(ast as BaseNode)[0];
      const arg = outer?.arguments[0] as unknown as { type: string; callee: { object: { type: string } } };
      expect(arg.type).toBe("CallExpression");
      expect(arg.callee.object.type).toBe("NolaExtractExpression");
    }
  });

  it("an untyped template in a slot is a plain string argument", () => {
    const src = "console.log(`hi`);\nf(`a`, `b`: string);\nf(`x`.length);\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(extracts(ast as BaseNode).map((e) => e.prompt)).toEqual(["b"]);
    // every template is still a TemplateLiteral node; `b` is the extractor's quasi
    expect(nodes(ast as BaseNode, "TemplateLiteral").map((t) => sliceSpan(src, t))).toEqual(["`hi`", "`a`", "`b`", "`x`"]);
    expect(calls(ast as BaseNode)[2]?.arguments[0]?.type).toBe("MemberExpression");
  });

  it("a call nested in a function inside the arguments has slots of its own", () => {
    const src = "f(() => g(`x`: string));\nf({ run() { return h(`y`: number); } });\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(extracts(ast as BaseNode).map((e) => e.prompt)).toEqual(["x", "y"]);
  });

  it("`<` after a template in a slot is a comparison unless it reads as type arguments", () => {
    const src = "f(`a` < b);\nf(`a` < b > c);\nf(`a` < b, `c`: string);\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(extracts(ast as BaseNode).map((e) => e.prompt)).toEqual(["c"]);
    expect(nodes(ast as BaseNode, "BinaryExpression")).toHaveLength(4);
    expect(nodes(ast as BaseNode, "TSInstantiationExpression")).toHaveLength(0);
  });

  it("a spaced colon is never the extractor's", () => {
    const { ast, diagnostics } = parseNola("f(`a` : string);\n", "x.tsi");
    expect(ast).toBeNull();
    expect(diagnostics[0]?.code).toBe("NOLA1001");
  });

  describe("outside a slot the dots are still required", () => {
    it.each([
      "const i = `x`: string;",
      "f(a ? `x`: string : b);",
      "f(...[`x`: string]);",
      "new Foo(`x`: string);",
      "const a = [`x`: string];",
      "const o = { a: `x`: string };",
      "f((`x`: string));",
      "f(() => [`x`: string]);",
      "f(a ? { n: `x`: string } : b);",
    ])("%s is a syntax error", (line) => {
      const { ast, diagnostics } = parseNola(`${line}\n`, "x.tsi");
      expect(ast).toBeNull();
      expect(diagnostics[0]?.code).toBe("NOLA1001");
    });

    it("a `<T>` template outside a slot still parses as TypeScript's instantiation expression (NOLA2014's input)", () => {
      const { ast, diagnostics } = parseNola("const i = `x`<string>;\nconst j = f((`y`<string>));\n", "x.tsi");
      expect(diagnostics).toEqual([]);
      expect(extracts(ast as BaseNode)).toHaveLength(0);
      expect(nodes(ast as BaseNode, "TSInstantiationExpression")).toHaveLength(2);
    });
  });

  describe("tolerant mode", () => {
    it("a glued colon with no type on its line is NOLA1018 and the extractor stays untyped", () => {
      for (const src of ["f(`x`: )\n", "f(`x`:\n)\n"]) {
        const { ast, diagnostics } = parseNola(src, "x.tsi", { tolerant: true });
        expect(ast).not.toBeNull();
        expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1018"]);
        const [e] = extracts(ast as BaseNode);
        expect(e?.typeArgs).toBeNull();
        expect(e?.nolaError).toBeUndefined();
      }
    });

    it("strict mode reports the same colon", () => {
      const { ast, diagnostics } = parseNola("f(`x`: )\n", "x.tsi");
      expect(ast).toBeNull();
      expect(diagnostics[0]?.code).toBe("NOLA1018");
    });
  });
});
