import {
  type BaseNode,
  type NolaAskExpression,
  type NolaExtractExpression,
  type NolaToolListNode,
  programBody,
  sliceSpan,
  walk,
} from "@nola-lang/ast";
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
const partTypes = (e: NolaExtractExpression | undefined) => (e?.parts ?? []).map((p) => p.type);
const typeOf = (e: NolaExtractExpression | undefined) =>
  (e?.typeArgs as unknown as { params: BaseNode[] } | null | undefined)?.params[0];
const codes = (src: string, tolerant = false) =>
  parseNola(src, "x.tsi", tolerant ? { tolerant: true } : {}).diagnostics.map((d) => d.code);

// The ask sequence (spec 2026-10-12 §3.1 / §3.2): text first, then texts and
// values alternating; the parser is kind-blind and returns `parts`.
describe("the ask sequence — parts", () => {
  it("texts and bare values alternate; the glued type ends the sequence", () => {
    const src = "const r = ask `use` admin `and default` cfg.defaults `go`: Result;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const [e] = extracts(ast as BaseNode);
    expect(partTypes(e)).toEqual(["TemplateLiteral", "Identifier", "TemplateLiteral", "MemberExpression", "TemplateLiteral"]);
    expect(e?.quasi).toBe(e?.parts[0]);
    expect(typeOf(e)?.type).toBe("TSTypeReference");
    expect(e?.colonType).toBe(true);
    expect(sliceSpan(src, e as BaseNode)).toBe("`use` admin `and default` cfg.defaults `go`: Result");
    expect(sliceSpan(src, asks(ast as BaseNode)[0] as BaseNode)).toBe("ask `use` admin `and default` cfg.defaults `go`: Result");
  });

  it("the type's colon follows the last part on its line, glued or spaced — after a text, a list or a bare value", () => {
    for (const [src, span] of [
      ["const r = ask `use` admin `go` : Result;\n", "`use` admin `go` : Result"],
      ["const r = ask `use` cfg.defaults : Result;\n", "`use` cfg.defaults : Result"],
      ["const f = ask `find` [searchFiles] `or` [readDir] : string[];\n", "`find` [searchFiles] `or` [readDir] : string[]"],
      ["const f = ask `find the files` [\n  searchFiles,\n  readFile\n] : string[];\n", "`find the files` [\n  searchFiles,\n  readFile\n] : string[]"],
    ]) {
      const { ast, diagnostics } = parseNola(src, "x.tsi");
      expect(diagnostics, src).toEqual([]);
      const [e] = extracts(ast as BaseNode);
      expect(e?.colonType, src).toBe(true);
      expect(typeOf(e), src).toBeDefined();
      expect(sliceSpan(src, e as BaseNode), src).toBe(span);
    }
  });

  it("a plain extractor has one part and no tools field", () => {
    const { ast, diagnostics } = parseNola("const p = ask `the person`: Person;\n", "x.tsi");
    expect(diagnostics).toEqual([]);
    const [e] = extracts(ast as BaseNode);
    expect(partTypes(e)).toEqual(["TemplateLiteral"]);
    expect("tools" in (e as object)).toBe(false);
  });

  it("lists are NolaToolList parts, with words between them", () => {
    const src = "const files = ask `find` [searchFiles, fs.readFile] `or` [readDir] `done`: string[];\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const [e] = extracts(ast as BaseNode);
    expect(partTypes(e)).toEqual(["TemplateLiteral", "NolaToolList", "TemplateLiteral", "NolaToolList", "TemplateLiteral"]);
    const lists = e?.parts.filter((p) => p.type === "NolaToolList") as NolaToolListNode[];
    expect(lists.map((l) => l.entries.map((t) => sliceSpan(src, t)))).toEqual([["searchFiles", "fs.readFile"], ["readDir"]]);
    expect(sliceSpan(src, lists[0] as BaseNode)).toBe("[searchFiles, fs.readFile]");
    expect(typeOf(e)?.type).toBe("TSArrayType");
  });

  it("the one-list shape still parses as a list right after the text", () => {
    const src = "const files = ask `find the visa files` [searchFiles, readFile]: string[];\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(partTypes(extracts(ast as BaseNode)[0])).toEqual(["TemplateLiteral", "NolaToolList"]);
  });

  it("a call with a typed slot is a value part; its slot is a one-part extractor", () => {
    const src = "const u = ask `register` createUser(`user id`: string, 42);\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const [outer, slot] = extracts(ast as BaseNode);
    expect(partTypes(outer)).toEqual(["TemplateLiteral", "CallExpression"]);
    expect(outer?.typeArgs).toBeNull();
    expect(partTypes(slot)).toEqual(["TemplateLiteral"]);
    expect(typeOf(slot)?.type).toBe("TSStringKeyword");
  });

  it("`: T` glues to a bare value's last token", () => {
    const src = "const r = ask `the owner of` project: Person;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const [e] = extracts(ast as BaseNode);
    expect(partTypes(e)).toEqual(["TemplateLiteral", "Identifier"]);
    expect(typeOf(e)?.type).toBe("TSTypeReference");
    expect(sliceSpan(src, e as BaseNode)).toBe("`the owner of` project: Person");
  });

  it("`<T>` after a bare value is a comparison, not type arguments", () => {
    const src = "const b = ask `p` user < T > 1;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const [e] = extracts(ast as BaseNode);
    expect(partTypes(e)).toEqual(["TemplateLiteral", "Identifier"]);
    expect(e?.typeArgs).toBeNull();
    expect(sliceSpan(src, e as BaseNode)).toBe("`p` user");
  });

  it("`<T>` after a text or a list still opens type arguments", () => {
    expect(codes("const a = ask `p` user `q`<string>;\n")).toEqual([]);
    expect(codes("const b = ask `p` [fn]<string>;\n")).toEqual([]);
    const { ast } = parseNola("const a = ask `p` user `q`<string>;\n", "x.tsi");
    expect(typeOf(extracts(ast as BaseNode)[0])?.type).toBe("TSStringKeyword");
  });

  it("a parenthesized expression, a literal, `new` and a plain call are bare values with their tails", () => {
    const src = "const r = ask `a` (x ?? y) `b` 42 `c` new Date() `d` getUser(id).name `e`: string;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const [e] = extracts(ast as BaseNode);
    expect(partTypes(e)).toEqual([
      "TemplateLiteral",
      "LogicalExpression",
      "TemplateLiteral",
      "NumericLiteral",
      "TemplateLiteral",
      "NewExpression",
      "TemplateLiteral",
      "MemberExpression",
      "TemplateLiteral",
    ]);
    const paren = e?.parts[1] as BaseNode & { nolaValueSpan?: { start: number; end: number } };
    expect(src.slice(paren.nolaValueSpan?.start, paren.nolaValueSpan?.end)).toBe("(x ?? y)");
  });

  it("the stored form takes the same sequence", () => {
    const src = "const p = ..`use` admin `now`: string;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(partTypes(extracts(ast as BaseNode)[0])).toEqual(["TemplateLiteral", "Identifier", "TemplateLiteral"]);
  });
});

describe("the ask sequence — where it ends", () => {
  it.each([
    ["a comma", "f(ask `p` user, 2);\n", "`p` user"],
    ["a closing bracket", "const a = [ask `p` user];\n", "`p` user"],
    ["an operator", "const a = ask `p` user ?? 1;\n", "`p` user"],
    ["a semicolon", "const a = ask `p` user;\n", "`p` user"],
  ])("ends before %s", (_what, src, span) => {
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(sliceSpan(src, extracts(ast as BaseNode)[0] as BaseNode)).toBe(span);
  });

  // A line break alone never ends an ask sequence (2026-10-15, owner's call
  // after `` `and`\nsomething.map(x => 1); `` silently lost its value): after
  // a text the next part may start on the next line, and the type may stand
  // on its own line after a text, a list or a value. The sequence ends where
  // the grammar cannot continue — a second value in a row, `;`, a closer, an
  // operator, a statement keyword — so a name after a VALUE is still a new
  // statement. Context statements keep JavaScript's rule.
  describe("across lines", () => {
    it("after a value, a name on the next line is a new statement; `[` or `(` on the next line continues", () => {
      const stmt = parseNola("const a = ask `p` user\nconsole.log(a);\n", "x.tsi");
      expect(stmt.diagnostics).toEqual([]);
      expect(partTypes(extracts(stmt.ast as BaseNode)[0])).toEqual(["TemplateLiteral", "Identifier"]);
      expect(nodes(stmt.ast as BaseNode, "ExpressionStatement")).toHaveLength(1);
      const list = parseNola("const a = ask `p`\n[fn]: string;\n", "x.tsi");
      expect(list.diagnostics).toEqual([]);
      expect(partTypes(extracts(list.ast as BaseNode)[0])).toEqual(["TemplateLiteral", "NolaToolList"]);
      const group = parseNola("const a = ask `p`\n(x): string;\n", "x.tsi");
      expect(group.diagnostics).toEqual([]);
      expect(partTypes(extracts(group.ast as BaseNode)[0])).toEqual(["TemplateLiteral", "Identifier"]);
    });

    it("after a text, a value may start on the next line — a name, a literal, `new`, an object", () => {
      const src = "const files = ask `the files` foo(`a`: string) `and` \nsomething.map((x) => 1);\n";
      const { ast, diagnostics } = parseNola(src, "x.tsi");
      expect(diagnostics).toEqual([]);
      expect(partTypes(extracts(ast as BaseNode)[0])).toEqual(["TemplateLiteral", "CallExpression", "TemplateLiteral", "CallExpression"]);
      expect(nodes(ast as BaseNode, "ExpressionStatement")).toHaveLength(0);
      for (const [line, type] of [
        ["42", "NumericLiteral"],
        ['"x"', "StringLiteral"],
        ["new Foo()", "NewExpression"],
        ["{ verbose: true }", "ObjectExpression"],
        ["user.name", "MemberExpression"],
      ]) {
        const s = `const r = ask \`use\`\n  ${line}\n  \`go\`: R;\n`;
        const p = parseNola(s, "x.tsi");
        expect(p.diagnostics, s).toEqual([]);
        expect(partTypes(extracts(p.ast as BaseNode)[0]), s).toEqual(["TemplateLiteral", type, "TemplateLiteral"]);
      }
    });

    it("the type may stand on its own line after a text, a list or a value", () => {
      for (const [src, span] of [
        ["const r = ask `p`\n  : Result;\n", "`p`\n  : Result"],
        ["const r = ask `p` [fn]\n  : Result;\n", "`p` [fn]\n  : Result"],
        ["const f = ask `p` something.map((x) => 1)\n  : string[];\n", "`p` something.map((x) => 1)\n  : string[]"],
      ]) {
        const { ast, diagnostics } = parseNola(src, "x.tsi");
        expect(diagnostics, src).toEqual([]);
        const [e] = extracts(ast as BaseNode);
        expect(e?.colonType, src).toBe(true);
        expect(typeOf(e), src).toBeDefined();
        expect(sliceSpan(src, e as BaseNode), src).toBe(span);
      }
    });

    it("one part per line", () => {
      const src = "const files = ask\n  `the files`\n  [searchFiles, readFile]\n  `use these`\n  patterns: string[];\n";
      const { ast, diagnostics } = parseNola(src, "x.tsi");
      expect(diagnostics).toEqual([]);
      const [e] = extracts(ast as BaseNode);
      expect(partTypes(e)).toEqual(["TemplateLiteral", "NolaToolList", "TemplateLiteral", "Identifier"]);
      expect(typeOf(e)?.type).toBe("TSArrayType");
    });

    it("a statement keyword on the next line ends the sequence", () => {
      for (const next of ["const x = 1;", "await other();", "this.x = 1;", "function g() {}", "class K {}", "typeof x;"]) {
        const src = `const r = ask \`w\` fn(\`a\`: string) \`done\`\n${next}\n`;
        const { ast, diagnostics } = parseNola(src, "x.tsi");
        expect(diagnostics, src).toEqual([]);
        expect(partTypes(extracts(ast as BaseNode)[0]), src).toEqual(["TemplateLiteral", "CallExpression", "TemplateLiteral"]);
        expect(programBody(ast as BaseNode), src).toHaveLength(2);
      }
    });
  });

  it("a method chain after the type keeps today's forms", () => {
    expect(codes("const a = ask `p` user `q`<string>.withRetry(2);\n")).toEqual([]);
    expect(codes("const a = (ask `p` user: string).withRetry(2);\n")).toEqual([]);
  });
});

describe("the ask sequence — what is refused (NOLA1020 at the ask site)", () => {
  it.each([
    ["`this`", "const a = ask `p` this;\n"],
    ["`await`", "const a = ask `p` await x;\n"],
    ["a nested bare `ask`", "const a = ask `p` ask `q`: string;\n"],
    ["a function", "const a = ask `p` function () {};\n"],
    ["an arrow", "const a = ask `p` (x) => x;\n"],
    ["a value ending in a template (the stop rule cannot see an argument-less `new`)", "const a = ask `p` new Foo `more`;\n"],
    ["text after the type", "const a = ask `p`: string `more`;\n"],
  ])("%s", (_what, src) => {
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(ast).toBeNull();
    expect(diagnostics[0]?.code).toBe("NOLA1020");
  });

  it("tolerant mode records NOLA1020 once and takes the refused expression as the value, so the file keeps parsing", () => {
    const { ast, diagnostics } = parseNola("const a = ask `p` this `q`: string;\nconst b = 1;\n", "x.tsi", { tolerant: true });
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1020"]);
    const [e] = extracts(ast as BaseNode);
    expect(partTypes(e)).toEqual(["TemplateLiteral", "ThisExpression", "TemplateLiteral"]);
    expect(typeOf(e)?.type).toBe("TSStringKeyword");
  });

  it("a value that ends in a template is the value followed by text (the stop rule): no error", () => {
    const src = "const a = ask `p` sql`select`: string;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(partTypes(extracts(ast as BaseNode)[0])).toEqual(["TemplateLiteral", "Identifier", "TemplateLiteral"]);
  });

  it("tolerant mode: a dangling member access inside a value recovers verbatim (TypeScript reports it) and the sequence goes on", () => {
    const { ast, diagnostics } = parseNola("const a = ask `p` user.\n", "x.tsi", { tolerant: true });
    expect(diagnostics).toEqual([]);
    expect(partTypes(extracts(ast as BaseNode)[0])[1]).toBe("MemberExpression");
  });
});

describe("the ask sequence — call slots", () => {
  it("a slot template keeps the one-template rule: `t` is a string and `user` is a syntax error", () => {
    const { ast, diagnostics } = parseNola("f(`t` user: string);\n", "x.tsi");
    expect(ast).toBeNull();
    expect(diagnostics[0]?.code).toBe("NOLA1001");
  });

  it("a `..` sequence in a slot parses (the lowerer refuses it)", () => {
    const { ast, diagnostics } = parseNola("f(..`t` user: string);\n", "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(partTypes(extracts(ast as BaseNode)[0])).toEqual(["TemplateLiteral", "Identifier"]);
  });
});
