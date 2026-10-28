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

  // A colon on the closing backtick's line is the type, glued or spaced
  // (spec §Grammar, amendment 2026-10-12): an untyped extractor is never
  // valid, so the ternary reading of `a ? ask `p` : b` was never a program —
  // the one shape a spaced colon could have meant. No backtracking: the
  // colon is read once, and the consequent case is NOLA1023 either way.
  describe("the colon follows the closing backtick on its line", () => {
    it("a colon after spaces or tabs is the type, at the ask site, after `ask with` and on the `..` form", () => {
      for (const [src, span] of [
        ["const x = ask `p` : number;\n", "`p` : number"],
        ["const x = ask `p`\t: number;\n", "`p`\t: number"],
        ["const x = ask with fast `p` : number;\n", "`p` : number"],
        ["const i = ..`p` : number;\n", "..`p` : number"],
      ]) {
        const { ast, diagnostics } = parseNola(src, "x.tsi");
        expect(diagnostics, src).toEqual([]);
        const [e] = extracts(ast as BaseNode);
        expect(typeOf(e)?.type, src).toBe("TSNumberKeyword");
        expect(e?.colonType, src).toBe(true);
        expect(sliceSpan(src, e as BaseNode), src).toBe(span);
      }
    });

    it("a spaced colon with nothing after it on its line is NOLA1018, like the glued one", () => {
      const { ast, diagnostics } = parseNola("const x = ask `p` :\nconsole.log(1);\n", "x.tsi");
      expect(ast).toBeNull();
      expect(diagnostics[0]?.code).toBe("NOLA1018");
      const tolerant = parseNola("const x = ask `p` :\nconsole.log(1);\n", "x.tsi", { tolerant: true });
      expect(tolerant.diagnostics.map((d) => d.code)).toEqual(["NOLA1018"]);
      expect(extracts(tolerant.ast as BaseNode)[0]?.typeArgs).toBeNull();
      expect(nodes(tolerant.ast as BaseNode, "ExpressionStatement")).toHaveLength(1);
    });

    it("an ask in a consequent takes a spaced colon as its type: NOLA1023 at the colon, glued alternate or not", () => {
      for (const src of ["const t = a ? ask `p` : b;\n", "const t = a ? ask `p` :b;\n"]) {
        const { ast, diagnostics } = parseNola(src, "x.tsi");
        expect(ast, src).toBeNull();
        expect(diagnostics[0]?.code, src).toBe("NOLA1023");
        expect(diagnostics[0]?.loc.start, src).toEqual({ line: 1, column: 22 });
      }
    });

    it("tolerant: the type swallowed the alternate — NOLA1023 alone, the type kept, a placeholder alternate, no bail", () => {
      const src = "const t = a ? ask `p` : b;\nconsole.log(t);\n";
      const { ast, diagnostics } = parseNola(src, "x.tsi", { tolerant: true });
      expect(ast).not.toBeNull();
      expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1023"]);
      const [cond] = nodes(ast as BaseNode, "ConditionalExpression") as Array<BaseNode & { alternate: BaseNode & { nolaError?: boolean } }>;
      expect(typeOf(extracts(ast as BaseNode)[0])?.type).toBe("TSTypeReference");
      expect(cond?.alternate.nolaError).toBe(true);
      expect(nodes(ast as BaseNode, "ExpressionStatement")).toHaveLength(1);
    });

    // Spec 2026-10-08 §1.5: a colon-typed extractor directly in a ternary's
    // consequent is parenthesized — two adjacent colons with different
    // meanings are hard on a reader, and the message beats Babel's "expected :"
    // when the type swallowed the alternate.
    describe("NOLA1023 — a typed ask directly in a ternary's consequent", () => {
      it("strict: the bare form is an error at the extractor's colon, even with the ternary's colon spaced", () => {
        const { ast, diagnostics } = parseNola("const t = a ? ask `p`: number : b;\n", "x.tsi");
        expect(ast).toBeNull();
        expect(diagnostics[0]?.code).toBe("NOLA1023");
        expect(diagnostics[0]?.loc.start).toEqual({ line: 1, column: 21 });
      });

      it("strict: the case the rule exists for — the type swallowed the alternate — gets this message, not \"expected :\"", () => {
        const { ast, diagnostics } = parseNola("const t = a ? ask `p`: b;\n", "x.tsi");
        expect(ast).toBeNull();
        expect(diagnostics[0]?.code).toBe("NOLA1023");
      });

      it("applies to the `..` form and to a `..` extractor in a slot's ternary", () => {
        for (const src of ["const i = c ? ..`p`: number : y;\n", "f(c ? ..`x`: string : y);\n", "const t = c ? ask ..`p`: number : y;\n"]) {
          const { ast, diagnostics } = parseNola(src, "x.tsi");
          expect(ast, src).toBeNull();
          expect(diagnostics[0]?.code, src).toBe("NOLA1023");
        }
      });

      it("tolerant: recorded, the extractor keeps its type and the ternary its colon", () => {
        const src = "const t = a ? ask `p`: number : b;\n";
        const { ast, diagnostics } = parseNola(src, "x.tsi", { tolerant: true });
        expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1023"]);
        const [cond] = nodes(ast as BaseNode, "ConditionalExpression") as Array<BaseNode & { alternate: BaseNode }>;
        expect(typeOf(extracts(ast as BaseNode)[0])?.type).toBe("TSNumberKeyword");
        expect(sliceSpan(src, cond?.alternate as BaseNode)).toBe("b");
      });

      it("the parenthesized ask, a parenthesized `..` operand, a call intent, the `<T>` form and the alternate position are legal", () => {
        const src = [
          "const a = c ? (ask `p`: number) : y;",
          "const b = c ? ask (..`p`: number) : y;",
          "const e = c ? ask createTicket(`t`: string) : y;",
          "const f = c ? ask `p`<number> : y;",
          "const g = c ? y : ask `p`: number;",
          "const h = c ? ask `p`: number[].withRetry(1) : y;",
          "const k = c ? y : ask `p` : number;",
          "",
        ].join("\n");
        const { ast, diagnostics } = parseNola(src, "x.tsi");
        expect(diagnostics).toEqual([]);
        expect(nodes(ast as BaseNode, "ConditionalExpression")).toHaveLength(7);
        expect(extracts(ast as BaseNode).map((e) => typeOf(e)?.type)).toEqual([
          "TSNumberKeyword",
          "TSNumberKeyword",
          "TSStringKeyword",
          "TSNumberKeyword",
          "TSNumberKeyword",
          "TSArrayType",
          "TSNumberKeyword",
        ]);
      });
    });

    it("nested, parenthesized and alternate positions read as written", () => {
      const src = [
        "const t = a ? f(ask `p`: number) : b;",
        "const u = a ? (ask `q`: string) : b;",
        "const v = a ? b ? ask `r`<number> : c : d;",
        "const w = a ? b : ask `s`: number;",
        "",
      ].join("\n");
      const { ast, diagnostics } = parseNola(src, "x.tsi");
      expect(diagnostics).toEqual([]);
      expect(extracts(ast as BaseNode).map((e) => typeOf(e)?.type)).toEqual([
        "TSNumberKeyword",
        "TSStringKeyword",
        "TSNumberKeyword",
        "TSNumberKeyword",
      ]);
      expect(nodes(ast as BaseNode, "ConditionalExpression")).toHaveLength(5);
    });

    it("a colon on the next line is the type too (a line break never ends an ask): the multi-line ternary consequent is NOLA1023, like the one-line form", () => {
      const src = "const t = a\n  ? ask `p`\n  : b;\n";
      const { ast, diagnostics } = parseNola(src, "x.tsi");
      expect(ast).toBeNull();
      expect(diagnostics[0]?.code).toBe("NOLA1023");
      expect(diagnostics[0]?.loc.start).toEqual({ line: 3, column: 2 });
      const tolerant = parseNola(src, "x.tsi", { tolerant: true });
      expect(tolerant.diagnostics.map((d) => d.code)).toEqual(["NOLA1023"]);
      expect(typeOf(extracts(tolerant.ast as BaseNode)[0])?.type).toBe("TSTypeReference");
      const typed = parseNola("const r = a\n  ? (ask `p`: number)\n  : b;\n", "x.tsi");
      expect(typed.diagnostics).toEqual([]);
      expect(nodes(typed.ast as BaseNode, "ConditionalExpression")).toHaveLength(1);
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
