// biome-ignore-all lint/suspicious/noTemplateCurlyInString: .tsi fixtures contain literal ${} interpolation
import { type BaseNode, walk } from "@nola-lang/ast";
import { parse as babelParse } from "@nola-lang/babel-parser";
import { parseNola } from "@nola-lang/parser";
import { describe, expect, it } from "vitest";

type Ctx = BaseNode & { parts: BaseNode[] };

/** The statements of the first function body, or the program's, as `type` names. */
function statements(src: string, tolerant = false): { body: BaseNode[]; diagnostics: string[] } {
  const { ast, diagnostics } = parseNola(src, "x.tsi", tolerant ? { tolerant: true } : {});
  const program = (ast as { program?: { body?: BaseNode[] } } | null)?.program;
  const first = program?.body?.[0] as { body?: { body?: BaseNode[] } } | undefined;
  const body = first?.type === "FunctionDeclaration" ? (first.body?.body ?? []) : (program?.body ?? []);
  return { body, diagnostics: diagnostics.map((d) => d.code) };
}
const partTypes = (stmt: BaseNode) => (stmt as Ctx).parts.map((p) => p.type);
const wrap = (body: string) => `infer function f(user: string, foo: any, ttt: any, aaa: any) {\n${body}\n}\n`;

describe("context statements (spec 2026-09-29 §3.1 / §3.2)", () => {
  it("a bare template literal statement is a NolaContextStatement with one text part", () => {
    const { body, diagnostics } = statements(wrap("  `analyze user`\n  return 1;"));
    expect(diagnostics).toEqual([]);
    expect(body[0]?.type).toBe("NolaContextStatement");
    expect(partTypes(body[0] as BaseNode)).toEqual(["TemplateLiteral"]);
    expect(body[1]?.type).toBe("ReturnStatement");
  });

  it("text value text on one line: three parts, the value an Identifier", () => {
    const { body, diagnostics } = statements(wrap("  `analyze the user:` user `and provide structural output`;"));
    expect(diagnostics).toEqual([]);
    expect(body).toHaveLength(1);
    expect(partTypes(body[0] as BaseNode)).toEqual(["TemplateLiteral", "Identifier", "TemplateLiteral"]);
  });

  it("values: a member chain, a call with an extractor argument, an array, an object, a parenthesized expression, `new`", () => {
    for (const [value, type] of [
      ["user.name.first", "MemberExpression"],
      ["problems.map(x => x.brief)", "CallExpression"],
      ["foo(..`user r`)", "CallExpression"],
      ["[foo, ttt, aaa]", "ArrayExpression"],
      ["{ a: 1 }", "ObjectExpression"],
      ["(user + 'x')", "BinaryExpression"],
      ["new Date()", "NewExpression"],
    ] as const) {
      const src = wrap(`  \`text\` ${value} \`more\`;`);
      const { body, diagnostics } = statements(src);
      expect(diagnostics, value).toEqual([]);
      expect(partTypes(body[0] as BaseNode), value).toEqual(["TemplateLiteral", type, "TemplateLiteral"]);
      // the value's own bytes, parentheses included — what the lowerer keeps verbatim
      const span = ((body[0] as Ctx).parts[1] as { nolaValueSpan?: { start: number; end: number } }).nolaValueSpan;
      expect(src.slice(span?.start, span?.end), value).toBe(value);
    }
  });

  it("a value may end the statement", () => {
    const { body, diagnostics } = statements(wrap("  `solved so far:` problems;"));
    expect(diagnostics).toEqual([]);
    expect(partTypes(body[0] as BaseNode)).toEqual(["TemplateLiteral", "Identifier"]);
  });

  it("the stop rule applies to the value's own base only: an inner tag stays a tag, the value still ends at the next text", () => {
    const { body, diagnostics } = statements(wrap("  `t` f(tag`x`) `more`;"));
    expect(diagnostics).toEqual([]);
    const [, call] = (body[0] as Ctx).parts;
    expect(call?.type).toBe("CallExpression");
    expect((call as { arguments: BaseNode[] }).arguments[0]?.type).toBe("TaggedTemplateExpression");
    expect(partTypes(body[0] as BaseNode)).toEqual(["TemplateLiteral", "CallExpression", "TemplateLiteral"]);
  });

  it("a name-led next line is a new statement (JS's rule): the template alone is the context statement", () => {
    for (const next of ["user `and report`;", "console.log('hi');", "user;", "typeof user;"]) {
      const { body, diagnostics } = statements(wrap(`  \`analyze\`\n  ${next}`));
      expect(diagnostics, next).toEqual([]);
      expect(body).toHaveLength(2);
      expect(partTypes(body[0] as BaseNode)).toEqual(["TemplateLiteral"]);
      expect(body[1]?.type).toBe("ExpressionStatement");
    }
  });

  it("a name-led next line after a VALUE is a new statement too", () => {
    const { body, diagnostics } = statements(wrap("  `text` user\n  console.log(1);"));
    expect(diagnostics).toEqual([]);
    expect(body.map((s) => s.type)).toEqual(["NolaContextStatement", "ExpressionStatement"]);
    expect(partTypes(body[0] as BaseNode)).toEqual(["TemplateLiteral", "Identifier"]);
  });

  it("a `{`-led next line is a block, as in JS", () => {
    const { body, diagnostics } = statements(wrap("  `analyze`\n  { a: 1 }"));
    expect(diagnostics).toEqual([]);
    expect(body.map((s) => s.type)).toEqual(["NolaContextStatement", "BlockStatement"]);
  });

  it("a `[`- or `(`-led next line continues the statement as a value; a text-led line always continues", () => {
    const { body, diagnostics } = statements(
      wrap("  `call this function only if you have enough params`\n    (foo(..`user r`))\n    `in case emergency call something from`\n    [foo, ttt, aaa];"),
    );
    expect(diagnostics).toEqual([]);
    expect(body).toHaveLength(1);
    expect(partTypes(body[0] as BaseNode)).toEqual(["TemplateLiteral", "CallExpression", "TemplateLiteral", "ArrayExpression"]);
  });

  it("a `[`-led next line takes its whole tail: `[foo].length` is the value of a context statement", () => {
    const { body, diagnostics } = statements(wrap("  `text`\n  [foo].length;"));
    expect(diagnostics).toEqual([]);
    expect(body).toHaveLength(1);
    expect(body[0]?.type).toBe("NolaContextStatement");
    expect(partTypes(body[0] as BaseNode)).toEqual(["TemplateLiteral", "MemberExpression"]);
  });

  it("a same-line group takes its whole tail too: `abc` then the value `[0].toUpperCase()`", () => {
    const { body, diagnostics } = statements(wrap("  `abc`[0].toUpperCase();"));
    expect(diagnostics).toEqual([]);
    expect(body).toHaveLength(1);
    expect(body[0]?.type).toBe("NolaContextStatement");
    expect(partTypes(body[0] as BaseNode)).toEqual(["TemplateLiteral", "CallExpression"]);
  });

  it("the roadmap's original multi-line form is two statements — the identifier line begins the second", () => {
    const { body, diagnostics } = statements(
      wrap("  `call this function only if you have enough params`\n    foo(..`user r`)\n    `in case emergency call something from`\n    [foo, ttt, aaa]\n  ;"),
    );
    expect(diagnostics).toEqual([]);
    expect(body).toHaveLength(2);
    expect(partTypes(body[0] as BaseNode)).toEqual(["TemplateLiteral"]);
    expect(body[1]?.type).toBe("ExpressionStatement");
  });

  it("two text parts after a value, each on its own line, are one statement", () => {
    const { body, diagnostics } = statements(wrap("  `Analyze` user\n  `carefully.`\n  `Then report.`;"));
    expect(diagnostics).toEqual([]);
    expect(partTypes(body[0] as BaseNode)).toEqual(["TemplateLiteral", "Identifier", "TemplateLiteral", "TemplateLiteral"]);
  });

  it("a chain of adjacent templates with no value is one statement of text parts", () => {
    const { body, diagnostics } = statements(wrap("  `you are super`\n  `another instruction`\n  return 1;"));
    expect(diagnostics).toEqual([]);
    expect(partTypes(body[0] as BaseNode)).toEqual(["TemplateLiteral", "TemplateLiteral"]);
    expect(body[1]?.type).toBe("ReturnStatement");
  });

  it("a `;` on its own line ends the statement, as in JS", () => {
    const { body, diagnostics } = statements(wrap("  `text` [foo]\n  ;\n  return 1;"));
    expect(diagnostics).toEqual([]);
    expect(body.map((s) => s.type)).toEqual(["NolaContextStatement", "ReturnStatement"]);
  });

  it("the module body takes the same statement", () => {
    const { body, diagnostics } = statements("`analyze:` user `and report`;\nconst user = 1;\n");
    expect(diagnostics).toEqual([]);
    expect(body.map((s) => s.type)).toEqual(["NolaContextStatement", "VariableDeclaration"]);
  });

  it("holes stay holes: `${}` inside a text part is the template's own expression", () => {
    const { body, diagnostics } = statements(wrap("  `at most ${n} words` user `ok`;"));
    expect(diagnostics).toEqual([]);
    const [text] = (body[0] as Ctx).parts as Array<{ expressions: BaseNode[] }>;
    expect(text?.expressions).toHaveLength(1);
  });

  describe("unchanged shapes keep today's AST", () => {
    const unchanged: Array<[string, string]> = [
      ["member access on the string", "  `text`.length;"],
      ["a parenthesized template", "  (`text`);"],
      ["a tagged template with a name tag", "  tag`text`;"],
      ["a template argument", "  f(`text`);"],
      ["a returned template", "  return `text`;"],
      ["an assigned template", "  const s = `text`;"],
      ["`.user` after text (member access, TypeScript's error later)", "  `text` .user `more`;"],
      ["`as` after text (a type assertion to a template literal type)", "  `text` as `x`;"],
      ["`in` after text", "  `text` in user;"],
    ];
    for (const [what, body] of unchanged) {
      it(what, () => {
        const src = wrap(body);
        const { ast, diagnostics } = parseNola(src, "x.tsi");
        expect(diagnostics, what).toEqual([]);
        const nodes: string[] = [];
        walk(ast as BaseNode, (n) => {
          if (n.type === "NolaContextStatement") nodes.push(n.type);
        });
        // none of these is a context statement: the expression is not a (chain of) template literal(s)
        expect(nodes, what).toEqual([]);
        // and the AST is today's byte for byte (spec 3.2): the same body in a plain function, parsed with the
        // nola mixin and with the typescript plugin alone, gives the same program, positions included
        const plainSrc = `function f(user: string, foo: any, ttt: any, aaa: any) {\n${body}\n}\n`;
        const programOf = (plugins: unknown[]) =>
          (babelParse(plainSrc, { sourceType: "module", plugins, attachComment: false }) as { program: unknown }).program;
        expect(JSON.stringify(programOf([["typescript", {}], "nola"])), what).toBe(JSON.stringify(programOf([["typescript", {}]])));
      });
    }
  });

  describe("NOLA1020 — a token that cannot continue the statement, on the same line", () => {
    for (const [what, body, token, column] of [
      ["an operator after a value", "  `text` user + 1;", "+", 14],
      ["an arrow after a value", "  `text` x => x;", "=>", 11],
      ["`as` after a value", "  `text` user as string;", "as", 14],
      ["a ternary after a value", "  `text` user ? 1 : 2;", "?", 14],
      ["`typeof` after text", "  `text` typeof user;", "typeof", 9],
      ["`ask` after text", "  `text` ask `p`<string>;", "ask", 9],
      ["`function` after text", "  `text` function () {};", "function", 9],
      ["`this` after text", "  `Page` this.user `now`;", "this", 9],
    ] as const) {
      it(`${what}: strict mode reports NOLA1020 at the token and bails`, () => {
        const src = wrap(body);
        const { ast, diagnostics } = parseNola(src, "x.tsi");
        expect(ast).toBeNull();
        expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1020"]);
        // at the token: line 2 of the wrapped source, its column, and the offset points at its text
        expect(diagnostics[0]?.loc.start).toEqual({ line: 2, column });
        expect(src.slice(diagnostics[0]?.start).startsWith(token)).toBe(true);
      });
    }

    // Every item is a hoisted function with a `this` of its own (TS2683 at check time, undefined at run
    // time), so `this` is no value — not even in a method, where it would mean something elsewhere.
    it("`this` is not a value, in an infer body or a method: NOLA1020, and the message says to assign it to a local first", () => {
      for (const [src, line, column] of [
        [wrap("  `Page` this.user `now`;"), 2, 9],
        ["class A {\n  m() {\n    `Page` this.user `now`;\n  }\n}\n", 3, 11],
      ] as const) {
        const { ast, diagnostics } = parseNola(src, "x.tsi");
        expect(ast, src).toBeNull();
        expect(diagnostics.map((d) => d.code), src).toEqual(["NOLA1020"]);
        expect(diagnostics[0]?.loc.start, src).toEqual({ line, column });
        expect(src.slice(diagnostics[0]?.start).startsWith("this"), src).toBe(true);
        expect(diagnostics[0]?.message, src).toContain("assign it to a local first (`await`, `ask` and `this` cannot be values)");
      }
    });

    it("a parenthesized `this` is still a value to the parser — TypeScript reports it (TS2683), not Nola", () => {
      const { body, diagnostics } = statements(wrap("  `Page` (this.user) `now`;"));
      expect(diagnostics).toEqual([]);
      expect(partTypes(body[0] as BaseNode)).toEqual(["TemplateLiteral", "MemberExpression", "TemplateLiteral"]);
    });
  });
});
