// biome-ignore-all lint/suspicious/noTemplateCurlyInString: .tsi fixtures and lowered output contain literal ${} interpolation
import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";
import { defHash } from "../src/lower/templates.js";

const DECLS = [
  "declare const admin: { name: string };",
  "declare const cfg: { defaults: { limit: number } };",
  "declare function createUser(id: string, n: number): Promise<{ id: string }>;",
  "declare function searchFiles(dir: string): string[];",
  "declare function readDir(dir: string): string[];",
  "declare const fileTools: { search(q: string): string[] };",
].join("\n");
const src = (ask: string) => `${DECLS}\n${ask}\n`;

// The ask sequence (spec 2026-10-12 §3.4): texts and values keep their bytes;
// only the seams are rewritten. Every request's accessor is numbered in
// lowering order: the answer type first, then the values.
describe("ask sequence lowering (emit 24) — extract", () => {
  it("texts and bare values lower to an instruction array of texts and __nola.var.obj parts", () => {
    const s = src("const r = ask `use` admin `and default` cfg.defaults `go`: string;");
    const { code, diagnostics } = compileNola(s, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain(
      "const r = await __nola.ask(__nola.intents.ExtractIntent<string>({ instruction: [`use`, " +
        '__nola.var.obj({ value: admin, name: "admin", type: __nola_type_$2() }), `and default`, ' +
        '__nola.var.obj({ value: cfg.defaults, name: "cfg.defaults", type: __nola_type_$3() }), `go`], ' +
        `type: __nola_type_$1(), loc: "7:15", def: "${defHash("x.tsi", "extract", "use\nadmin\nand default\ncfg.defaults\ngo", "string")}" }), __nola_module_ctx());`,
    );
    expect(code).toContain("__nola.useRuntime(24);");
    // the value accessors are optional (the omit policy returns undefined), the answer type's is not
    expect(code).toContain(
      'function __nola_type_$1(): import("@nola-lang/runtime").InferType<unknown> { return (undefined as never); }',
    );
    expect(code).toContain(
      'function __nola_type_$2(): import("@nola-lang/runtime").InferType<unknown> | undefined { return (undefined as never); }',
    );
  });

  it("records a `value` request per bare value, over the value's own bytes, under the omit policy", () => {
    const s = src("const r = ask `use` admin `and` (cfg.defaults) `go`: string;");
    const { code, meta } = compileNola(s, "x.tsi");
    const values = meta.derivations.filter((d) => d.kind === "value");
    expect(values.map((d) => [d.accessor, s.slice(d.source.start, d.source.end), d.policy])).toEqual([
      ["__nola_type_$2", "admin", "omit"],
      ["__nola_type_$3", "(cfg.defaults)", "omit"],
    ]);
    expect(values.map((d) => code.slice(d.lowered.start, d.lowered.end))).toEqual(["admin", "(cfg.defaults)"]);
  });

  it("a one-text ask lowers byte for byte as before (no array, no var)", () => {
    const s = src("const p = ask `the person`: string;");
    const { code } = compileNola(s, "x.tsi");
    expect(code).toContain("__nola.intents.ExtractIntent<string>({ instruction: `the person`, type: __nola_type_$1(),");
    expect(code).not.toContain("__nola.var");
  });

  it("a value holding a nested ask gets no type accessor (its bytes are no longer one verbatim run)", () => {
    const s = src("const r = ask `summarize` (ask `the report`: string) `now`: string;");
    const { code, diagnostics, meta } = compileNola(s, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(meta.derivations.filter((d) => d.kind === "value")).toEqual([]);
    expect(code).toContain(
      "__nola.var.obj({ value: (await __nola.ask(__nola.intents.ExtractIntent<string>({ instruction: `the report`",
    );
    expect(code).toContain(', name: "(ask `the report`: string)" })');
  });

  it("holes in any text stay words through fmt", () => {
    const s = src("const n = 3;\nconst r = ask `at most ${n}` admin `words ${n}`: string;");
    const { code, diagnostics } = compileNola(s, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain("instruction: [`at most ${__nola.fmt(n)}`, __nola.var.obj({ value: admin");
    expect(code).toContain("`words ${__nola.fmt(n)}`], type:");
  });

  it("an untyped sequence is NOLA2004", () => {
    const { diagnostics } = compileNola(src("const r = ask `use` admin `go`;"), "x.tsi");
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA2004"]);
  });

  it("a multi-line sequence keeps its line layout", () => {
    const s = src("const r = ask `use` admin\n  `and` [searchFiles]\n  `go`: string;\nconsole.log(r);");
    const { code, diagnostics } = compileNola(s, "x.tsi");
    expect(diagnostics).toEqual([]);
    const lines = code.split("\n");
    expect(lines[6]).toContain("__nola.intents.ToolUseIntent<string>({ instruction: [`use`, __nola.var.obj({ value: admin");
    expect(lines[7]).toContain("`and`, __nola.var.tools(__nola.tool(searchFiles");
    expect(lines[8]).toContain("`go`], type: __nola_type_$1()");
    expect(lines[9]).toBe("console.log(r);");
  });
});

describe("ask sequence lowering (emit 24) — call", () => {
  it("text plus a call with a typed slot lowers to a FunctionCallIntent over a func part", () => {
    const s = src("const u = ask `register` createUser(`user id`: string, 42);");
    const { code, diagnostics } = compileNola(s, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain(
      "const u = await __nola.ask(__nola.intents.FunctionCallIntent<Awaited<ReturnType<typeof createUser>>>({ instruction: [`register`, " +
        '__nola.var.func({ fn: createUser, name: "createUser", args: [__nola.intents.ExtractIntent<string>({ instruction: `user id`, type: __nola_type_$1(), loc: "7:37", def: "' +
        defHash("x.tsi", "extract", "user id", "string") +
        '" }), 42] })], ' +
        `loc: "7:15", def: "${defHash("x.tsi", "call", "register\ncreateUser(`user id`: string, 42)", "")}" }), __nola_module_ctx());`,
    );
  });

  it("a bare call and a hinted call lower byte for byte as before", () => {
    const { code } = compileNola(
      src("const u = ask createUser(`user id`: string, 42);\nconst v = ask createUser`be quick`(`user id`: string, 42);"),
      "x.tsi",
    );
    expect(code).toContain(
      '__nola.intents.FunctionCallIntent<Awaited<ReturnType<typeof createUser>>>({ fn: createUser, name: "createUser", instruction: "", loc:',
    );
    expect(code).toContain('name: "createUser", instruction: "be quick", loc:');
    expect(code).not.toContain("__nola.var");
  });

  it("`: T` beside a call part, two call parts, and text after a bare call are NOLA2020", () => {
    expect(
      compileNola(src("const u = ask `register` createUser(`id`: string, 1): string;"), "x.tsi").diagnostics.map((d) => d.code),
    ).toEqual(["NOLA2020"]);
    expect(
      compileNola(src("const u = ask `a` createUser(`id`: string, 1) `b` createUser(`id`: string, 2);"), "x.tsi").diagnostics.map(
        (d) => d.code,
      ),
    ).toEqual(["NOLA2020"]);
    expect(compileNola(src("const u = ask createUser(`id`: string, 1) `more`;"), "x.tsi").diagnostics.map((d) => d.code)).toEqual([
      "NOLA2020",
    ]);
  });

  it("a call intent inside a data value is NOLA2020 (the action written as data)", () => {
    const { diagnostics } = compileNola(src("const u = ask `use` (createUser(`id`: string, 1)) `go`: string;"), "x.tsi");
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA2020"]);
  });
});

describe("ask sequence lowering (emit 24) — tool use", () => {
  it("several lists lower to one tools part each; the same written entry in two lists is one tool, re-emitted where written", () => {
    const s = src("const files = ask `find` [searchFiles, fileTools] `or` [readDir, searchFiles] `done`: string[];");
    const { code, diagnostics, meta } = compileNola(s, "x.tsi");
    expect(diagnostics).toEqual([]);
    // the repeated `searchFiles` keeps its place in the second list (the model reads each list's names where
    // written, spec §1.4) under the FIRST list's accessor — one request, one tool
    expect(code).toContain(
      "__nola.intents.ToolUseIntent<string[]>({ instruction: [`find`, " +
        '__nola.var.tools(__nola.tool(searchFiles, __nola_tool_$2(), "searchFiles"), __nola.tool(fileTools, __nola_tool_$3(), "fileTools")), `or`, ' +
        '__nola.var.tools(__nola.tool(readDir, __nola_tool_$4(), "readDir"), __nola.tool(searchFiles, __nola_tool_$2(), "searchFiles")), `done`], ' +
        `type: __nola_type_$1(), loc: "7:19", def: "${defHash("x.tsi", "tool-use", "find\n[searchFiles,fileTools]\nor\n[readDir,searchFiles]\ndone", "string[]")}" })`,
    );
    expect(meta.derivations.filter((d) => d.kind === "tool").map((d) => d.tool?.written)).toEqual(["searchFiles", "fileTools", "readDir"]);
    // the repeated entry is anchored too, so hover works on it
    expect(meta.anchors.filter((a) => s.slice(a.sourceStart, a.sourceEnd) === "searchFiles")).toHaveLength(2);
  });

  it("a list repeated whole is re-emitted whole: a spread twice is two spread parts over one request", () => {
    const s = src("const f = ask `a` [...fileTools] `b` [...fileTools] `c`: string[];");
    const { code, diagnostics, meta } = compileNola(s, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain(
      "instruction: [`a`, __nola.var.tools(__nola.toolSpread(fileTools, __nola_tool_$2())), `b`, __nola.var.tools(__nola.toolSpread(fileTools, __nola_tool_$2())), `c`], type: __nola_type_$1()",
    );
    expect(meta.derivations.filter((d) => d.kind === "tool")).toHaveLength(1);
  });

  it("the one-text, one-list shape lowers byte for byte as before", () => {
    const s = src("const files = ask `find` [searchFiles, readDir]: string[];");
    const { code } = compileNola(s, "x.tsi");
    expect(code).toContain(
      '__nola.intents.ToolUseIntent<string[]>({ instruction: `find`, tools: [__nola.tool(searchFiles, __nola_tool_$2(), "searchFiles"), __nola.tool(readDir, __nola_tool_$3(), "readDir")], ' +
        `type: __nola_type_$1(), loc: "7:19", def: "${defHash("x.tsi", "tool-use", "find", "string[]\nsearchFiles,readDir")}" })`,
    );
    expect(code).not.toContain("__nola.var");
  });

  it("the same entry twice in one list, and two entries sharing a wire name across lists, are NOLA2018", () => {
    expect(
      compileNola(src("const f = ask `a` [searchFiles, searchFiles] `b` [readDir]: string[];"), "x.tsi").diagnostics.map((d) => d.code),
    ).toEqual(["NOLA2018"]);
    expect(
      compileNola(
        src("declare const a_b: () => void; declare const a: { b(): void };\nconst f = ask `x` [a.b] `y` [a_b]: string[];"),
        "x.tsi",
      ).diagnostics.map((d) => d.code),
    ).toEqual(["NOLA2018"]);
  });

  it("a list beside a call part is NOLA2019 (reserved)", () => {
    const { diagnostics } = compileNola(src("const u = ask `use` [searchFiles] `then` createUser(`id`: string, 1);"), "x.tsi");
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA2019"]);
    expect(diagnostics[0]?.message).toContain("reserved");
  });

  it("data values with lists keep the tool-use kind", () => {
    const s = src("const f = ask `find` [searchFiles] `for` admin `now`: string[];");
    const { code, diagnostics } = compileNola(s, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain("ToolUseIntent<string[]>({ instruction: [`find`, __nola.var.tools(");
    expect(code).toContain(
      '`for`, __nola.var.obj({ value: admin, name: "admin", type: __nola_type_$3() }), `now`], type: __nola_type_$1()',
    );
  });
});

describe("ask sequence lowering (emit 24) — slots, holes, tolerant mode", () => {
  it("a `..` sequence inside a call slot is NOLA2019", () => {
    const { diagnostics } = compileNola(src("const u = ask createUser(..`id` admin: string, 1);"), "x.tsi");
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA2019"]);
  });

  it("a value holding a construct the lowerer edits reports that construct's diagnostic and gets no type accessor", () => {
    // a contextual binding inside a plain function (NOLA1010) and a context statement there (NOLA2017): the
    // value's bytes are no longer one verbatim run, so no `value` request is made — and nothing throws
    const binding = compileNola(src("const r = ask `use` (() => { const .x = 1; return x; }) `go`: string;"), "x.tsi");
    expect(binding.diagnostics.map((d) => d.code)).toEqual(["NOLA1010"]);
    expect(binding.meta.derivations.filter((d) => d.kind === "value")).toEqual([]);
    expect(binding.code).toContain('__nola.var.obj({ value: (() => {');
    expect(binding.code).toContain(', name: "(() => { const .x = 1; return x; })" })');
    const item = compileNola(src("const r = ask `use` (() => { `ctx`; return 1; }) `go`: string;"), "x.tsi");
    expect(item.diagnostics.map((d) => d.code)).toEqual(["NOLA2017"]);
    expect(item.meta.derivations.filter((d) => d.kind === "value")).toEqual([]);
  });

  it("a sequence inside a context statement's hole is NOLA2010 only", () => {
    const s = "infer function f() {\n  `item ${ask `p` x `q`: string}`\n  return 1;\n}\n";
    const { diagnostics } = compileNola(s, "x.tsi");
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA2010"]);
  });

  it("tolerant: a half-typed sequence lowers with NOLA2004 and keeps the value in place", () => {
    const s = "declare const us: { a: 1 };\nconst r = ask `p` us";
    const { code, diagnostics } = compileNola(s, "x.tsi", { tolerant: true });
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA2004"]);
    expect(code).toContain(
      '__nola.intents.ExtractIntent<any>({ instruction: [`p`, __nola.var.obj({ value: us, name: "us", type: __nola_type_$1() })], type: __nola.types.string()',
    );
  });
});
