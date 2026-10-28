import {
  type BaseNode,
  type NolaAskExpression,
  type NolaExtractExpression,
  type NolaToolListNode,
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
const typeOf = (e: NolaExtractExpression | undefined) =>
  (e?.typeArgs as unknown as { params: BaseNode[] } | null | undefined)?.params[0];
// Since the ask sequence (spec 2026-10-12) a list is a `NolaToolList` part; the entries of every list, flat.
const listsOf = (e: NolaExtractExpression | undefined) =>
  (e?.parts ?? []).filter((p) => p.type === "NolaToolList") as NolaToolListNode[];
const entriesOf = (e: NolaExtractExpression | undefined) => listsOf(e).flatMap((l) => l.entries);
const toolsOf = (src: string, e: NolaExtractExpression | undefined) => entriesOf(e).map((t) => sliceSpan(src, t));

// The tool list (spec 2026-10-08): `` ask `task` [fn, g.h]: T `` — a bracketed
// list of function names directly after the template of an ask-site or `..`
// extractor, before its type. Brackets OFFER functions (the model may call
// them before it answers); parentheses RUN one (a call intent).
describe("tool list — `ask `p` [a, b]: T`", () => {
  it("parses the list between the template and the colon type", () => {
    const src = "const files = ask `find the visa files` [searchFiles, readFile]: string[];\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const [e] = extracts(ast as BaseNode);
    expect(toolsOf(src, e)).toEqual(["searchFiles", "readFile"]);
    expect(typeOf(e)?.type).toBe("TSArrayType");
    expect(sliceSpan(src, e as BaseNode)).toBe("`find the visa files` [searchFiles, readFile]: string[]");
    expect(sliceSpan(src, asks(ast as BaseNode)[0] as BaseNode)).toBe("ask `find the visa files` [searchFiles, readFile]: string[]");
    expect(entriesOf(e).map((t) => t.type)).toEqual(["Identifier", "Identifier"]);
  });

  it("takes the angle-bracket spelling after the list, glued or spaced", () => {
    for (const src of ["const u = ask `get the user` [getUser]<User>;\n", "const u = ask `get the user` [getUser] <User>;\n"]) {
      const { ast, diagnostics } = parseNola(src, "x.tsi");
      expect(diagnostics).toEqual([]);
      const [e] = extracts(ast as BaseNode);
      expect(toolsOf(src, e)).toEqual(["getUser"]);
      expect(typeOf(e)?.type).toBe("TSTypeReference");
    }
  });

  it("an untyped ask keeps its list", () => {
    const src = "const u = ask `get the user` [getUser];\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const [e] = extracts(ast as BaseNode);
    expect(toolsOf(src, e)).toEqual(["getUser"]);
    expect(typeOf(e)).toBeUndefined();
  });

  it("works after `ask with <name>`, on the `..` form, with member chains, a trailing comma and a multi-line list", () => {
    const src = [
      "const w = ask with fast `p` [a, b]: number;",
      "const i = ..`p` [fs.promises.readFile, api.search,]: string;",
      "const m = ask `p` [",
      "  searchFiles,",
      "  fs.readFile,",
      "]: string[];",
      "",
    ].join("\n");
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const all = extracts(ast as BaseNode);
    expect(all.map((e) => toolsOf(src, e))).toEqual([
      ["a", "b"],
      ["fs.promises.readFile", "api.search"],
      ["searchFiles", "fs.readFile"],
    ]);
    expect(all.map((e) => typeOf(e)?.type)).toEqual(["TSNumberKeyword", "TSStringKeyword", "TSArrayType"]);
    expect(entriesOf(all[1]).map((t) => t.type)).toEqual(["MemberExpression", "MemberExpression"]);
    expect((asks(ast as BaseNode)[0] as unknown as { provider: { name: string } }).provider.name).toBe("fast");
  });

  it("a list may open on the line after the template (JavaScript never ends a statement before `[`)", () => {
    const src = "const u = ask `get the user`\n  [getUser]: User;\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(toolsOf(src, extracts(ast as BaseNode)[0])).toEqual(["getUser"]);
  });

  it("intent methods chain after a delimited type or the angle-bracket form, as without a list", () => {
    const src = ["const a = ask `p` [t]: string[].withRetry(2);", "const b = ask `p` [t]<User>.withTimeout(5);", ""].join("\n");
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const calls = nodes(ast as BaseNode, "CallExpression");
    expect(calls).toHaveLength(2);
    expect(extracts(ast as BaseNode).map((e) => toolsOf(src, e))).toEqual([["t"], ["t"]]);
  });

  it("the type's colon follows the bracket on its line, glued or spaced, and the type must start on the colon's line", () => {
    // Glued or spaced, a colon on the bracket's line is the type (colon-typed
    // spec, amendment 2026-10-12): an untyped ask is never valid, so no
    // ternary reading is lost. The multi-line list is the shape that asked
    // for it — `]` at the margin, then ` : string[]`.
    for (const [src, span] of [
      ["const u = ask `p` [getUser]: User;\n", "`p` [getUser]: User"],
      ["const u = ask `p` [getUser] : User;\n", "`p` [getUser] : User"],
      ["const u = ask `p` [\n  getUser,\n  readFile\n] : User;\n", "`p` [\n  getUser,\n  readFile\n] : User"],
      ["const u = ask `p` [getUser]\n  : User;\n", "`p` [getUser]\n  : User"],
    ]) {
      const { ast, diagnostics } = parseNola(src, "x.tsi");
      expect(diagnostics, src).toEqual([]);
      const [e] = extracts(ast as BaseNode);
      expect(typeOf(e)?.type, src).toBe("TSTypeReference");
      expect(e?.colonType, src).toBe(true);
      expect(sliceSpan(src, e as BaseNode), src).toBe(span);
    }
    const broken = parseNola("const u = ask `p` [getUser]:\nconsole.log(1);\n", "x.tsi");
    expect(broken.ast).toBeNull();
    expect(broken.diagnostics[0]?.code).toBe("NOLA1018");
    const tolerant = parseNola("const u = ask `p` [getUser]:\nconsole.log(1);\n", "x.tsi", { tolerant: true });
    expect(tolerant.diagnostics.map((d) => d.code)).toEqual(["NOLA1018"]);
    expect(toolsOf("const u = ask `p` [getUser]:\nconsole.log(1);\n", extracts(tolerant.ast as BaseNode)[0])).toEqual(["getUser"]);
  });

  describe("a bracket is a list only directly after an ask-site or `..` template", () => {
    it("a bracket in a call slot keeps its JavaScript meaning", () => {
      const src = ["f(`x`[0]);", "f(`x`: string, [a, b]);", "const t = `abc`[1];", ""].join("\n");
      const { ast, diagnostics } = parseNola(src, "x.tsi");
      expect(diagnostics).toEqual([]);
      const all = extracts(ast as BaseNode);
      expect(all).toHaveLength(1);
      expect(listsOf(all[0])).toEqual([]);
      expect(sliceSpan(src, all[0] as BaseNode)).toBe("`x`: string");
      // the two indexes are member accesses on plain template literals
      const members = nodes(ast as BaseNode, "MemberExpression").filter((m) => (m as unknown as { computed: boolean }).computed);
      expect(members).toHaveLength(2);
    });

    it("a context statement's bracketed value and a subscript on an ask are unchanged", () => {
      const src = ["infer function f() {", "  `use` [a, b] `now`;", "  const r = ask `p`.withRetry(1);", "}", ""].join("\n");
      const { ast, diagnostics } = parseNola(src, "x.tsi");
      expect(diagnostics).toEqual([]);
      expect(nodes(ast as BaseNode, "NolaContextStatement")).toHaveLength(1);
      expect(listsOf(extracts(ast as BaseNode)[0])).toEqual([]);
    });
  });

  describe("NOLA1021 — a literal entry, or an empty list", () => {
    it.each([
      ["const u = ask `p` [];\n", 1],
      ["const u = ask `p` [1];\n", 1],
      ['const u = ask `p` ["a"];\n', 1],
      ["const u = ask `p` [() => a];\n", 1],
      ["const u = ask `p` [`x`];\n", 1],
      ["const u = ask `p` [this];\n", 1],
      ["const u = ask `p` [new A()];\n", 1],
      ["const u = ask `p` [{ a }];\n", 1],
      ["const u = ask `p` [[a]];\n", 1],
      ["const u = ask `p` [(1)];\n", 1],
      ["const u = ask `p` [a, 1, b];\n", 1],
    ])("strict: %s", (src, line) => {
      const { ast, diagnostics } = parseNola(src, "x.tsi");
      expect(ast).toBeNull();
      expect(diagnostics[0]?.code).toBe("NOLA1021");
      expect(diagnostics[0]?.loc.start.line).toBe(line);
    });

    it("a spread of a literal is reported on the literal", () => {
      const { diagnostics } = parseNola("const u = ask `p` [...1];\n", "x.tsi", { tolerant: true });
      expect(diagnostics.map((d) => [d.code, d.loc.start.column])).toEqual([["NOLA1021", 22]]);
    });

    it("tolerant: the bad entries are dropped and the rest of the list is kept", () => {
      const src = "const u = ask `p` [a, 1, b, `x`]: User;\n";
      const { ast, diagnostics } = parseNola(src, "x.tsi", { tolerant: true });
      expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1021", "NOLA1021"]);
      expect(diagnostics.map((d) => d.loc.start.column)).toEqual([22, 28]);
      const [e] = extracts(ast as BaseNode);
      expect(toolsOf(src, e)).toEqual(["a", "b"]);
      expect(typeOf(e)?.type).toBe("TSTypeReference");
    });

    it("tolerant: an empty list is reported on the bracket and the ask keeps parsing", () => {
      const src = "const u = ask `p` []: User;\nconsole.log(u);\n";
      const { ast, diagnostics } = parseNola(src, "x.tsi", { tolerant: true });
      expect(diagnostics.map((d) => [d.code, d.loc.start.column])).toEqual([["NOLA1021", 18]]);
      const [e] = extracts(ast as BaseNode);
      expect(listsOf(e)).toHaveLength(1);
      expect(entriesOf(e)).toEqual([]);
      expect(typeOf(e)?.type).toBe("TSTypeReference");
    });
  });

  // Values (spec 2026-10-09 §1.1): anything the checker could read as a
  // function or a group is accepted here and judged in phase two.
  describe("value entries — judged by the checker, not the parser", () => {
    it.each([
      ["const u = ask `p` [...fns];\n", "...fns", "SpreadElement"],
      ["const u = ask `p` [...makeTools()];\n", "...makeTools()", "SpreadElement"],
      ["const u = ask `p` [a?.b];\n", "a?.b", "OptionalMemberExpression"],
      ["const u = ask `p` [a[0]];\n", "a[0]", "MemberExpression"],
      ["const u = ask `p` [(a)];\n", "a", "Identifier"],
      ["const u = ask `p` [cond ? a : b];\n", "cond ? a : b", "ConditionalExpression"],
      ["const u = ask `p` [fileTools, ...dbTools, tools.db];\n", "fileTools", "Identifier"],
    ])("%s", (src, first, type) => {
      const { ast, diagnostics } = parseNola(src, "x.tsi");
      expect(diagnostics).toEqual([]);
      const [e] = extracts(ast as BaseNode);
      expect(toolsOf(src, e)[0]).toBe(first);
      expect(entriesOf(e)[0]?.type).toBe(type);
    });
  });

  describe("NOLA1022 — a call-shaped or tagged entry is reserved", () => {
    it.each(["const u = ask `p` [getUser(`id`: string)];\n", "const u = ask `p` [a()];\n", "const u = ask `p` [a`hint`];\n", "const u = ask `p` [fs.readFile(path)];\n"])(
      "strict: %s",
      (src) => {
        const { ast, diagnostics } = parseNola(src, "x.tsi");
        expect(ast).toBeNull();
        expect(diagnostics[0]?.code).toBe("NOLA1022");
        expect(diagnostics[0]?.loc.start.column).toBe(19);
      },
    );

    it("tolerant: the reserved entry is dropped", () => {
      const src = "const u = ask `p` [getUser(`id`: string), readFile]: User;\n";
      const { ast, diagnostics } = parseNola(src, "x.tsi", { tolerant: true });
      expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1022"]);
      expect(toolsOf(src, extracts(ast as BaseNode)[0])).toEqual(["readFile"]);
    });
  });

  describe("tolerant recovery of a half-typed list", () => {
    it.each([
      ["const u = ask `p` [a, b\n", ["a", "b"]],
      ["const u = ask `p` [a, b;\nconsole.log(1);\n", ["a", "b"]],
      ["const u = ask `p` [a;\n", ["a"]],
      ["const u = ask `p` [\n", []],
      ["const u = ask `p` [a,\n", ["a"]],
    ])("an unclosed list ends at the last entry: %s", (src, tools) => {
      const { ast, diagnostics } = parseNola(src, "x.tsi", { tolerant: true });
      expect(diagnostics[0]?.code).toBe("NOLA1001");
      expect(diagnostics[0]?.message).toContain("`]`");
      expect(ast).not.toBeNull();
      expect(toolsOf(src, extracts(ast as BaseNode)[0])).toEqual(tools);
    });

    it("an unclosed list inside a call recovers before the call's closing paren", () => {
      const src = "f(ask `p` [a);\n";
      const { ast, diagnostics } = parseNola(src, "x.tsi", { tolerant: true });
      expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1001"]);
      expect(toolsOf(src, extracts(ast as BaseNode)[0])).toEqual(["a"]);
      expect(nodes(ast as BaseNode, "CallExpression")).toHaveLength(1);
    });

    it("a missing comma is reported and the next entry still read", () => {
      const src = "const u = ask `p` [a b]: User;\n";
      const strict = parseNola(src, "x.tsi");
      expect(strict.ast).toBeNull();
      expect(strict.diagnostics[0]?.code).toBe("NOLA1001");
      const { ast, diagnostics } = parseNola(src, "x.tsi", { tolerant: true });
      expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1001"]);
      expect(toolsOf(src, extracts(ast as BaseNode)[0])).toEqual(["a", "b"]);
    });

    it("strict: an unclosed list is a syntax error", () => {
      const { ast, diagnostics } = parseNola("const u = ask `p` [a, b\n", "x.tsi");
      expect(ast).toBeNull();
      expect(diagnostics[0]?.code).toBe("NOLA1001");
    });
  });
});
