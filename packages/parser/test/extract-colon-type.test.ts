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
const typeOf = (e: NolaExtractExpression | undefined) =>
  (e?.typeArgs as unknown as { params: BaseNode[] } | null | undefined)?.params[0];

// Colon-typed extractors (spec 2026-09-23): `: T` after the closing backtick
// is a second spelling of `<T>`, yielding the same typeArgs shape.
describe("extractor `: T` spelling", () => {
  it("`ask `p`: T` types the extractor like `<T>`", () => {
    const src = "const userId = ask `user id`: number;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const [e] = extracts(ast as BaseNode);
    const t = typeOf(e);
    expect(t?.type).toBe("TSNumberKeyword");
    expect(sliceSpan(src, t as BaseNode)).toBe("number");
    expect(sliceSpan(src, e as BaseNode)).toBe("`user id`: number");
    expect(sliceSpan(src, asks(ast as BaseNode)[0] as BaseNode)).toBe("ask `user id`: number");
  });

  it("works after `ask with <name>`, on the `..` form, in a call slot and with a decision type", () => {
    const src = [
      "const w = ask with fast `p`: number;",
      "const i = ..`p`: string;",
      "const c = ask f(..`a`: string, 2);",
      'const d = ask ..`q`: Choice<"a" | "b">;',
      "",
    ].join("\n");
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const all = extracts(ast as BaseNode);
    expect(all.map((e) => typeOf(e)?.type)).toEqual(["TSNumberKeyword", "TSStringKeyword", "TSStringKeyword", "TSTypeReference"]);
    expect(sliceSpan(src, all[3] as BaseNode)).toBe('..`q`: Choice<"a" | "b">');
    expect((asks(ast as BaseNode)[0] as unknown as { provider: { name: string } }).provider.name).toBe("fast");
  });

  it("takes any TypeScript type", () => {
    const src = [
      "const a = ask `a`: { id: number; name?: string };",
      "const b = ask `b`: Map<string, number>;",
      "const c = ask `c`: T extends U ? X : Y;",
      "const d = ask `d`: (x: number) => void;",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a template literal TYPE in .tsi fixture source
      "const e = ask `e`: `id-${string}`;",
      "",
    ].join("\n");
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(extracts(ast as BaseNode).map((e) => typeOf(e)?.type)).toEqual([
      "TSTypeLiteral",
      "TSTypeReference",
      "TSConditionalType",
      "TSFunctionType",
      "TSTemplateLiteralType",
    ]);
  });

  it("subscripts after a delimited type attach to the extractor", () => {
    const src = "const r = ask `p`: string[].withRetry(2);\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const arg = asks(ast as BaseNode)[0]?.argument as unknown as { type: string; callee: { object: BaseNode } };
    expect(arg.type).toBe("CallExpression");
    expect(arg.callee.object.type).toBe("NolaExtractExpression");
    expect(sliceSpan(src, typeOf(arg.callee.object as NolaExtractExpression) as BaseNode)).toBe("string[]");
  });

  it("the `<T>` spelling is unchanged", () => {
    const src = "const o = ask `p`<number>;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const [e] = extracts(ast as BaseNode);
    expect(typeOf(e)?.type).toBe("TSNumberKeyword");
    expect(sliceSpan(src, e as BaseNode)).toBe("`p`<number>");
  });

  // The colon is the type only when it is GLUED to the closing backtick, like
  // an annotation; a colon after whitespace is never the extractor's (spec
  // §Grammar). That is what keeps a ternary's separator out of the type.
  describe("the colon must touch the closing backtick", () => {
    it("a colon after whitespace is not a type — the ordinary syntax error stands", () => {
      const { ast, diagnostics } = parseNola("const x = ask `p` : number;\n", "x.tsi");
      expect(ast).toBeNull();
      expect(diagnostics[0]?.code).toBe("NOLA1001");
    });

    it("an untyped ask in a consequent leaves a spaced colon to the ternary, even with the alternate glued to it", () => {
      for (const src of ["const t = a ? ask `p` : b;\n", "const t = a ? ask `p` :b;\n"]) {
        const { ast, diagnostics } = parseNola(src, "x.tsi");
        expect(diagnostics).toEqual([]);
        const [cond] = nodes(ast as BaseNode, "ConditionalExpression") as Array<BaseNode & { alternate: BaseNode }>;
        expect(cond).toBeDefined();
        expect(typeOf(extracts(ast as BaseNode)[0])).toBeUndefined();
        expect(sliceSpan(src, cond?.alternate as BaseNode)).toBe("b");
      }
    });

    it("a typed ask in the consequent keeps its type and the ternary its colon", () => {
      const src = "const t = a ? ask `p`: number : b;\n";
      const { ast, diagnostics } = parseNola(src, "x.tsi");
      expect(diagnostics).toEqual([]);
      const [cond] = nodes(ast as BaseNode, "ConditionalExpression") as Array<BaseNode & { alternate: BaseNode }>;
      expect(typeOf(extracts(ast as BaseNode)[0])?.type).toBe("TSNumberKeyword");
      expect(sliceSpan(src, cond?.alternate as BaseNode)).toBe("b");
    });

    it("nested, parenthesized and alternate positions read as written", () => {
      const src = [
        "const t = a ? f(ask `p`: number) : b;",
        "const u = a ? (ask `q`: string) : b;",
        "const v = a ? b ? ask `r` : c : d;",
        "const w = a ? b : ask `s`: number;",
        "",
      ].join("\n");
      const { ast, diagnostics } = parseNola(src, "x.tsi");
      expect(diagnostics).toEqual([]);
      expect(extracts(ast as BaseNode).map((e) => typeOf(e)?.type)).toEqual([
        "TSNumberKeyword",
        "TSStringKeyword",
        undefined,
        "TSNumberKeyword",
      ]);
      expect(nodes(ast as BaseNode, "ConditionalExpression")).toHaveLength(5);
    });

    it("a multi-line ternary with the alternate's colon on its own line is unaffected", () => {
      const src = "const t = a\n  ? ask `p`\n  : b;\n";
      const { ast, diagnostics } = parseNola(src, "x.tsi");
      expect(diagnostics).toEqual([]);
      expect(nodes(ast as BaseNode, "ConditionalExpression")).toHaveLength(1);
      expect(typeOf(extracts(ast as BaseNode)[0])).toBeUndefined();
    });
  });

  // The type must start on the colon's line: TypeScript's type grammar reads
  // across line breaks, so an unfinished `: ` would otherwise take the next
  // line's first expression as a qualified type name.
  describe("NOLA1018 — a colon with no type on its line", () => {
    it("strict: a line break after the colon is an error, not a type read from the next line", () => {
      const { ast, diagnostics } = parseNola("const x = ask `p`:\nconsole.log(1);\n", "x.tsi");
      expect(ast).toBeNull();
      expect(diagnostics[0]?.code).toBe("NOLA1018");
      expect(diagnostics[0]?.loc.start.line).toBe(1);
    });

    it("strict: `;` right after the colon", () => {
      const { ast, diagnostics } = parseNola("const x = ask `p`: ;\n", "x.tsi");
      expect(ast).toBeNull();
      expect(diagnostics[0]?.code).toBe("NOLA1018");
    });

    it("tolerant: the colon is consumed, the extractor stays untyped and the next line is its own statement", () => {
      const src = "const x = ask `p`:\nconsole.log(1);\n";
      const { ast, diagnostics } = parseNola(src, "x.tsi", { tolerant: true });
      expect(ast).not.toBeNull();
      expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1018"]);
      const [e] = extracts(ast as BaseNode);
      expect(e?.typeArgs).toBeNull();
      expect(e?.nolaError).toBeUndefined();
      expect(sliceSpan(src, e as BaseNode)).toBe("`p`:");
      expect(nodes(ast as BaseNode, "ExpressionStatement")).toHaveLength(1);
    });

    it("tolerant: at the end of the file and before a closer", () => {
      for (const src of ["const x = ask `p`:", "f(ask `p`: )\n"]) {
        const { ast, diagnostics } = parseNola(src, "x.tsi", { tolerant: true });
        expect(ast).not.toBeNull();
        expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1018"]);
        expect(extracts(ast as BaseNode)[0]?.typeArgs).toBeNull();
      }
    });
  });
});
