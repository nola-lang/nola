import { type BaseNode, walk } from "@nola-lang/ast";
import { parseNola } from "@nola-lang/parser";
import { describe, expect, it } from "vitest";

type Ctx = BaseNode & { parts: BaseNode[] };

const wrap = (body: string) => `infer function f(user: string, foo: any, ttt: any) {\n${body}\n}\n`;
const bodyOf = (ast: unknown) =>
  ((ast as { program: { body: Array<{ body: { body: BaseNode[] } }> } }).program.body[0]?.body.body ?? []) as BaseNode[];
const partTypes = (stmt: BaseNode | undefined) => (stmt as Ctx | undefined)?.parts?.map((p) => p.type);
const contextStatements = (ast: unknown) => {
  const found: string[] = [];
  walk(ast as BaseNode, (n) => {
    if (n.type === "NolaContextStatement") found.push(n.type);
  });
  return found;
};

// JavaScript parses `text` [a] and `text` (x) as an index and a call ON the
// string, before parseExpressionStatement can see the group. The plugin's
// leading-text rule (parseSubscript) leaves a `[` or `(` right after a
// statement's leading text to the statement loop, which parses it as the first
// value WITH its whole left-hand-side tail (spec 2026-09-29 §3.2) — the plan's
// tests pin the shapes of the spec's table; these pin the edges of that rule.
describe("context statements: a bracket group right after the leading text", () => {
  it("is the first value — array and paren shapes JavaScript could not index or call included", () => {
    for (const [value, type] of [
      ["[]", "ArrayExpression"],
      ["[...foo]", "ArrayExpression"],
      ["[foo, , ttt,]", "ArrayExpression"],
      ["(foo, ttt)", "SequenceExpression"],
    ] as const) {
      const { ast, diagnostics } = parseNola(wrap(`  \`tools:\` ${value} \`more\`;`), "x.tsi");
      expect(diagnostics, value).toEqual([]);
      expect(partTypes(bodyOf(ast)[0]), value).toEqual(["TemplateLiteral", type, "TemplateLiteral"]);
    }
  });

  it("keeps its whole tail: the first value is the full left-hand-side expression", () => {
    for (const [body, types] of [
      ["  `text` (foo)(ttt);", ["TemplateLiteral", "CallExpression"]],
      ["  `text` [foo][ttt] `more`;", ["TemplateLiteral", "MemberExpression", "TemplateLiteral"]],
      ["  `a` `b` [foo].length;", ["TemplateLiteral", "TemplateLiteral", "MemberExpression"]],
      ["  `text`\n  [foo, ttt].forEach(f);", ["TemplateLiteral", "CallExpression"]],
      ["  `text`\n  (function () {})();", ["TemplateLiteral", "CallExpression"]],
    ] as const) {
      const { ast, diagnostics } = parseNola(wrap(body), "x.tsi");
      expect(diagnostics, body).toEqual([]);
      expect(bodyOf(ast), body).toHaveLength(1);
      expect(partTypes(bodyOf(ast)[0]), body).toEqual(types);
    }
  });

  it("that is not a valid value is an ordinary syntax error (NOLA1001)", () => {
    for (const body of ["  `text` () `more`;", "  `text` [foo ttt] `more`;"]) {
      const { ast, diagnostics } = parseNola(wrap(body), "x.tsi");
      expect(ast, body).toBeNull();
      expect(diagnostics.map((d) => d.code), body).toEqual(["NOLA1001"]);
    }
  });

  it("an arrow after a parenthesized group is NOLA1020 — the group is a value, never an arrow head", () => {
    const { ast, diagnostics } = parseNola(wrap("  `text` (foo) => foo;"), "x.tsi");
    expect(ast).toBeNull();
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1020"]);
  });

  it("after a value a group is that value's own subscript, on either line", () => {
    for (const body of ["  `text` foo [ttt] `more`;", "  `text` foo\n  [ttt] `more`;"]) {
      const { ast, diagnostics } = parseNola(wrap(body), "x.tsi");
      expect(diagnostics, body).toEqual([]);
      expect(partTypes(bodyOf(ast)[0]), body).toEqual(["TemplateLiteral", "MemberExpression", "TemplateLiteral"]);
    }
  });

  it("after a run of several texts the group is still the first value", () => {
    const { ast, diagnostics } = parseNola(wrap("  `a` `b` [foo] `c`;"), "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(partTypes(bodyOf(ast)[0])).toEqual(["TemplateLiteral", "TemplateLiteral", "ArrayExpression", "TemplateLiteral"]);
  });

  it("the statements after the group parse normally", () => {
    const { ast, diagnostics } = parseNola(wrap("  `a` [foo] `b`;\n  const y = 1;\n  return y;"), "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(bodyOf(ast).map((s) => s.type)).toEqual(["NolaContextStatement", "VariableDeclaration", "ReturnStatement"]);
  });

  it("the module body takes the same rule", () => {
    const { ast, diagnostics } = parseNola("`a` [x] `b`;\nconst x = 1;\n", "x.tsi");
    expect(diagnostics).toEqual([]);
    expect((ast as unknown as { program: { body: BaseNode[] } }).program.body.map((s) => s.type)).toEqual([
      "NolaContextStatement",
      "VariableDeclaration",
    ]);
  });
});

// A tagged template with TypeScript type arguments is not text: the chain stays
// ordinary code, so no `<T>` bytes ever sit in the gap between two parts.
describe("context statements: a chain of templates", () => {
  it("with type arguments between two of them is ordinary code — no context statement, no diagnostic", () => {
    const { ast, diagnostics } = parseNola(wrap("  `a`<T>`b`;"), "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(contextStatements(ast)).toEqual([]);
  });
});

// A dangling dot is the existing parseMember recovery (a zero-width property).
// Inside a context value a keyword on the NEXT line is not a property name
// either: it starts the statement that was already below the line being typed.
describe("tolerant recovery: a dangling dot in a value above a keyword-led line", () => {
  it("`const` on the next line starts its own statement — no diagnostic", () => {
    const { ast, diagnostics } = parseNola(wrap("  `Page` user.\n  const x = 1;"), "t.tsi", { tolerant: true });
    expect(diagnostics).toEqual([]);
    expect(bodyOf(ast).map((s) => s.type)).toEqual(["NolaContextStatement", "VariableDeclaration"]);
  });

  it("a keyword right after the dot, on the same line, is still a property name", () => {
    const { ast, diagnostics } = parseNola(wrap("  `Page` user.default `more`;"), "t.tsi", { tolerant: true });
    expect(diagnostics).toEqual([]);
    expect(partTypes(bodyOf(ast)[0])).toEqual(["TemplateLiteral", "MemberExpression", "TemplateLiteral"]);
  });

  it("outside a context value the same shape parses as it always did", () => {
    const { ast, diagnostics } = parseNola(wrap("  const q = user.\n  return q;"), "t.tsi", { tolerant: true });
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1001"]);
    expect(bodyOf(ast).map((s) => s.type)).toEqual(["VariableDeclaration", "ExpressionStatement"]);
  });

  // TypeScript's own rule: on the line after the dot, a name or keyword that is
  // itself followed, on its own line, by another name or keyword cannot be a
  // property name.
  it("a line that starts with two names in a row starts its own statement: `let y`, `await foo`, `type X`, `async function`", () => {
    for (const [below, next] of [
      ["  let y = 1;", "VariableDeclaration"],
      ["  await foo;", "ExpressionStatement"],
      ["  type X = number;", "TSTypeAliasDeclaration"],
      ["  async function g() {}", "FunctionDeclaration"],
    ] as const) {
      const { ast, diagnostics } = parseNola(wrap(`  \`Page\` user.\n${below}`), "t.tsi", { tolerant: true });
      expect(diagnostics, below).toEqual([]);
      expect(bodyOf(ast).map((s) => s.type), below).toEqual(["NolaContextStatement", next]);
    }
  });

  it("a lone name on the next line is still a property", () => {
    const { ast, diagnostics } = parseNola(wrap("  `Page` user.\n  name\n  `more`;"), "t.tsi", { tolerant: true });
    expect(diagnostics).toEqual([]);
    expect(partTypes(bodyOf(ast)[0])).toEqual(["TemplateLiteral", "MemberExpression", "TemplateLiteral"]);
    const [, member] = (bodyOf(ast)[0] as Ctx).parts as unknown as Array<{ property?: { name?: string } }>;
    expect(member?.property?.name).toBe("name");
  });

  it("holds in a nested expression of the value too — an arrow body in `items.map(...)`", () => {
    const { ast, diagnostics } = parseNola(
      wrap("  `Page` items.map((x) => {\n    return x.\n    return 2;\n  }) `more`;"),
      "t.tsi",
      { tolerant: true },
    );
    expect(diagnostics).toEqual([]);
    expect(partTypes(bodyOf(ast)[0])).toEqual(["TemplateLiteral", "CallExpression", "TemplateLiteral"]);
  });

  it("outside a context value the same arrow body parses as it always did", () => {
    const { diagnostics } = parseNola(
      wrap("  const q = items.map((x) => {\n    return x.\n    return 2;\n  });"),
      "t.tsi",
      { tolerant: true },
    );
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1001"]);
  });
});

// `await` is an identifier-range token to the tokenizer, but never a value: it
// reaches NOLA1020 like the other tokens the spec lists (§3.2), wrapped in
// parentheses it is an ordinary value.
describe("context statements: `await` after text", () => {
  it("is NOLA1020, not Babel's reserved-word error", () => {
    const { ast, diagnostics } = parseNola(wrap("  `text` await foo `more`;"), "x.tsi");
    expect(ast).toBeNull();
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1020"]);
  });

  it("a parenthesized await is a value", () => {
    const { ast, diagnostics } = parseNola(wrap("  `text` (await foo) `more`;"), "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(partTypes(bodyOf(ast)[0])).toEqual(["TemplateLiteral", "AwaitExpression", "TemplateLiteral"]);
  });
});

// A value never ENDS with a template literal: `sql`select`` is the value `sql`
// followed by text (the stop rule), so a template at the end of a parsed value is
// text the value swallowed anyway — after TypeScript's `f<T>` (its own branch
// builds the tagged template) or as the callee of an argument-less `new`.
describe("context statements: a value never ends with a template literal", () => {
  it("`foo<string> `more`` is NOLA1020 at the swallowed text — strict mode bails", () => {
    const { ast, diagnostics } = parseNola(wrap("  `text` foo<string> `more`;"), "x.tsi");
    expect(ast).toBeNull();
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1020"]);
    expect(diagnostics[0]?.loc.start).toEqual({ line: 2, column: 21 });
  });

  it("so is an argument-less `new`: its callee took the text", () => {
    for (const [body, column] of [
      ["  `text` new Foo `more`;", 17],
      ["  `text` new Foo.Bar `more`;", 21],
      ["  `text` new new Foo `more`;", 21],
    ] as const) {
      const { ast, diagnostics } = parseNola(wrap(body), "x.tsi");
      expect(ast, body).toBeNull();
      expect(diagnostics.map((d) => d.code), body).toEqual(["NOLA1020"]);
      expect(diagnostics[0]?.loc.start, body).toEqual({ line: 2, column });
    }
  });

  it("tolerant mode records NOLA1020, keeps the value as parsed and goes on — the file does not bail", () => {
    for (const [body, type] of [
      ["  `text` foo<string> `more`;\n  return 1;", "TaggedTemplateExpression"],
      ["  `text` new Foo `more`;\n  return 1;", "NewExpression"],
    ] as const) {
      const { ast, diagnostics } = parseNola(wrap(body), "t.tsi", { tolerant: true });
      expect(diagnostics.map((d) => d.code), body).toEqual(["NOLA1020"]);
      expect(bodyOf(ast).map((s) => s.type), body).toEqual(["NolaContextStatement", "ReturnStatement"]);
      expect(partTypes(bodyOf(ast)[0]), body).toEqual(["TemplateLiteral", type]);
    }
  });

  it("parenthesized, the same values stop where the text starts — and a tag call inside parentheses is not the value's end", () => {
    for (const [value, type] of [
      ["(foo<string>)", "TSInstantiationExpression"],
      ["new Foo()", "NewExpression"],
      ["(new Foo)", "NewExpression"],
      ["(new Foo`x`)", "NewExpression"],
    ] as const) {
      const { ast, diagnostics } = parseNola(wrap(`  \`text\` ${value} \`more\`;`), "x.tsi");
      expect(diagnostics, value).toEqual([]);
      expect(partTypes(bodyOf(ast)[0]), value).toEqual(["TemplateLiteral", type, "TemplateLiteral"]);
    }
  });
});

// Text is a template literal in every position (spec 3.1), so an invalid escape
// is the ordinary NOLA1001 wherever the text stands. Babel parses the
// continuation lines of `a` ⏎ `b` as TAGGED templates, where a bad escape is
// legal and its cooked text is null — which would reach __nola.ctx as undefined.
describe("context statements: an invalid escape in a text part", () => {
  const bs = String.fromCharCode(92); // a lone backslash, so the fixtures need no escaping
  const badText = `\`C:${bs}users\``; // a backslash before "u" starts no escape
  const goodText = `\`tab${bs}there\``; // a backslash before "t" is a tab

  it("is NOLA1001 in every position: first, after a value, and on a continuation line", () => {
    for (const body of [`  ${badText};`, `  \`a\` user ${badText};`, `  \`a\`\n  ${badText};`, `  \`a\` ${badText};`]) {
      const { ast, diagnostics } = parseNola(wrap(body), "x.tsi");
      expect(ast, body).toBeNull();
      expect(diagnostics.map((d) => d.code), body).toEqual(["NOLA1001"]);
    }
  });

  it("on a continuation line the error is at the text's own start", () => {
    const next = parseNola(wrap(`  \`a\`\n  ${badText};`), "x.tsi");
    expect(next.diagnostics[0]?.loc.start).toEqual({ line: 3, column: 3 });
    const same = parseNola(wrap(`  \`a\` ${badText};`), "x.tsi");
    expect(same.diagnostics[0]?.loc.start).toEqual({ line: 2, column: 7 });
  });

  it("tolerant mode records it once and the file does not bail", () => {
    const { ast, diagnostics } = parseNola(wrap(`  \`a\`\n  ${badText};\n  return 1;`), "t.tsi", { tolerant: true });
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1001"]);
    expect(bodyOf(ast).map((s) => s.type)).toEqual(["NolaContextStatement", "ReturnStatement"]);
    expect(partTypes(bodyOf(ast)[0])).toEqual(["TemplateLiteral", "TemplateLiteral"]);
  });

  it("a valid escape on a continuation line stays valid, with a cooked string", () => {
    const { ast, diagnostics } = parseNola(wrap(`  \`a\`\n  ${goodText};`), "x.tsi");
    expect(diagnostics).toEqual([]);
    const [, text] = (bodyOf(ast)[0] as Ctx).parts as unknown as Array<{ quasis: Array<{ value: { cooked: string | null } }> }>;
    expect(text?.quasis[0]?.value.cooked).toBe(`tab${String.fromCharCode(9)}here`);
  });
});

// `async` is an identifier-range token, so `async function () {}` starts a value
// as a FunctionExpression while plain `function` is NOLA1020 (spec 3.2 lists it):
// a value is never a function or class expression unless it is parenthesized.
describe("context statements: a function expression as a value", () => {
  it("`async function () {}` is NOLA1020 at the value's start — strict mode bails", () => {
    const { ast, diagnostics } = parseNola(wrap("  `text` async function () {} `more`;"), "x.tsi");
    expect(ast).toBeNull();
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1020"]);
    expect(diagnostics[0]?.loc.start).toEqual({ line: 2, column: 9 });
  });

  it("tolerant mode records it, keeps the function as the value and goes on", () => {
    const { ast, diagnostics } = parseNola(wrap("  `text` async function () {} `more`;\n  return 1;"), "t.tsi", { tolerant: true });
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1020"]);
    expect(bodyOf(ast).map((s) => s.type)).toEqual(["NolaContextStatement", "ReturnStatement"]);
    expect(partTypes(bodyOf(ast)[0])).toEqual(["TemplateLiteral", "FunctionExpression", "TemplateLiteral"]);
  });

  it("parenthesized, a function or an arrow is an ordinary value, and `async` alone is a name", () => {
    for (const [value, type] of [
      ["(async () => 1)", "ArrowFunctionExpression"],
      ["(async function () {})", "FunctionExpression"],
      ["async", "Identifier"],
    ] as const) {
      const { ast, diagnostics } = parseNola(wrap(`  \`text\` ${value} \`more\`;`), "x.tsi");
      expect(diagnostics, value).toEqual([]);
      expect(partTypes(bodyOf(ast)[0]), value).toEqual(["TemplateLiteral", type, "TemplateLiteral"]);
    }
  });
});
