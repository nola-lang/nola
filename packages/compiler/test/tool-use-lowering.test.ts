// biome-ignore-all lint/suspicious/noTemplateCurlyInString: .tsi fixtures and lowered output contain literal ${} interpolation
import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";
import { defHash } from "../src/lower/templates.js";

const SRC = [
  "declare function searchFiles(dir: string, pattern?: string): Promise<string[]>;",
  "declare const fs: { readFile(path: string): Promise<string> };",
  "declare const fileTools: { search(q: string): string[] };",
  "declare const dbTools: { query(sql: string): string[] };",
  "declare const tools: Array<(x: string) => string>;",
  "const files = ask `find the visa files` [searchFiles, fs.readFile, tools[0], fileTools, ...dbTools]: string[];",
  "",
].join("\n");

// Tool lists by value (spec 2026-10-09 §3.3): every entry lowers to a deferred
// source — `__nola.tool(value, verdict, written?, receiver?)` for a bare entry,
// `__nola.toolSpread(value, verdict)` for a spread — whose verdict is an
// appendix accessor the checker fills in; the answer type derives as for an
// extractor; the def hashes the written entries in order.
describe("tool-use lowering (emit 24)", () => {
  it("lowers an ask with a tool list to a ToolUseIntent over deferred sources", () => {
    const { code, diagnostics } = compileNola(SRC, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain(
      "__nola.intents.ToolUseIntent<string[]>({ instruction: `find the visa files`, tools: [" +
        '__nola.tool(searchFiles, __nola_tool_$2(), "searchFiles"), ' +
        '__nola.tool(fs.readFile, __nola_tool_$3(), "fs.readFile", fs), ' +
        "__nola.tool(tools[0], __nola_tool_$4(), undefined, tools), " +
        '__nola.tool(fileTools, __nola_tool_$5(), "fileTools"), ' +
        "__nola.toolSpread(dbTools, __nola_tool_$6())], " +
        `type: __nola_type_$1(), loc: "6:19", def: "${defHash("x.tsi", "tool-use", "find the visa files", "string[]\nsearchFiles,fs.readFile,tools[0],fileTools,...dbTools")}" })`,
    );
    expect(code).toContain("__nola.useRuntime(24);");
  });

  it("requests the answer type and one verdict per entry, anchored where the checker reads it, flagged spread / written", () => {
    const { code, meta } = compileNola(SRC, "x.tsi");
    expect(meta.derivations.map((d) => d.kind)).toEqual(["extract", "tool", "tool", "tool", "tool", "tool"]);
    expect(meta.derivations.map((d) => d.accessor)).toEqual([
      "__nola_type_$1",
      "__nola_tool_$2",
      "__nola_tool_$3",
      "__nola_tool_$4",
      "__nola_tool_$5",
      "__nola_tool_$6",
    ]);
    expect(meta.derivations.map((d) => SRC.slice(d.source.start, d.source.end))).toEqual([
      "string[]",
      "searchFiles",
      "fs.readFile",
      "tools[0]",
      "fileTools",
      "dbTools",
    ]);
    expect(meta.derivations.map((d) => code.slice(d.lowered.start, d.lowered.end))).toEqual([
      "string[]",
      "searchFiles",
      "fs.readFile",
      "tools[0]",
      "fileTools",
      "dbTools",
    ]);
    expect(meta.derivations.slice(1).map((d) => d.tool)).toEqual([
      { ask: "6:19", written: "searchFiles" },
      { ask: "6:19", written: "fs.readFile" },
      { ask: "6:19" },
      { ask: "6:19", written: "fileTools" },
      { ask: "6:19", spread: true },
    ]);
    const list = SRC.indexOf("[searchFiles");
    for (const text of ["searchFiles", "fs.readFile", "tools[0]", "fileTools"]) {
      const start = list + SRC.slice(list).indexOf(text);
      expect(meta.anchors.some((a) => a.sourceStart === start && a.sourceEnd === start + text.length)).toBe(true);
    }
    const dbStart = SRC.indexOf("...dbTools") + 3;
    expect(meta.anchors.some((a) => a.sourceStart === dbStart && a.sourceEnd === dbStart + "dbTools".length)).toBe(true);
    // the phase-1 appendix declares every verdict accessor inert, typed as a verdict
    expect(code).toContain('function __nola_tool_$2(): import("@nola-lang/runtime").ToolVerdict { return (undefined as never); }');
  });

  it("the `..` form lowers identically (loc aside); untyped takes the string type, `<T>` its type", () => {
    const bare = compileNola("declare function a(): void;\nconst i = ask `p` [a]: string;\n", "x.tsi");
    const sigil = compileNola("declare function a(): void;\nconst i = ask ..`p` [a]: string;\n", "x.tsi");
    expect(bare.diagnostics).toEqual([]);
    const stripLoc = (c: string) => c.replace(/loc: "\d+:\d+"/g, 'loc: ""');
    expect(stripLoc(bare.code)).toBe(stripLoc(sigil.code));
    expect(bare.code).toContain('loc: "2:15"');
    const untyped = compileNola("declare function a(): void;\nconst i = ask `p` [a];\n", "x.tsi");
    expect(untyped.diagnostics).toEqual([]);
    expect(untyped.code).toContain(
      '__nola.intents.ToolUseIntent<any>({ instruction: `p`, tools: [__nola.tool(a, __nola_tool_$1(), "a")], type: __nola.types.string()',
    );
    const angle = compileNola("declare function a(): void;\ntype User = { id: string };\nconst i = ask `p` [a]<User>;\n", "x.tsi");
    expect(angle.diagnostics).toEqual([]);
    expect(angle.code).toContain("__nola.intents.ToolUseIntent<User>({");
  });

  it("the def hashes the written entries in order", () => {
    const head = "declare function a(): void;\ndeclare function b(): void;\n";
    const one = compileNola(`${head}const i = ask \`p\` [a, b]: string;\n`, "x.tsi").code;
    const two = compileNola(`${head}const i = ask \`p\` [b, a]: string;\n`, "x.tsi").code;
    expect(one).toContain(`def: "${defHash("x.tsi", "tool-use", "p", "string\na,b")}"`);
    expect(two).toContain(`def: "${defHash("x.tsi", "tool-use", "p", "string\nb,a")}"`);
  });

  it("NOLA2018 — the same entry twice, or two entries that share a wire name", () => {
    const dup = compileNola("declare function a(): void;\nconst i = ask `p` [a, a]: string;\n", "x.tsi");
    expect(dup.diagnostics.map((d) => [d.code, d.loc.start.column])).toEqual([["NOLA2018", 22]]);
    const clash = compileNola("declare const a: { b(): void };\ndeclare function a_b(): void;\nconst i = ask `p` [a.b, a_b]: string;\n", "x.tsi");
    expect(clash.diagnostics.map((d) => d.code)).toEqual(["NOLA2018"]);
    expect(clash.diagnostics[0]?.message).toContain("a_b");
    expect(clash.diagnostics[0]?.message).toContain("a.b");
  });

  it("two written entries sharing a wire name are NOLA2018 in the lowerer; a group beside its own member is left to derive", () => {
    const dup = compileNola("declare const a: { b(): void }; declare function a_b(): void;\nconst i = ask `p` [a.b, a_b]: string;\n", "x.tsi");
    expect(dup.diagnostics.map((d) => [d.code, d.loc.start.line])).toEqual([["NOLA2018", 2]]);
    const group = compileNola("declare const fileTools: { readFile(p: string): string };\nconst i = ask `p` [fileTools, fileTools.readFile]: string;\n", "x.tsi");
    expect(group.diagnostics).toEqual([]);
  });

  it("a method reached through an optional or indexed chain keeps its object as the receiver; an object with a call is NOLA2018", () => {
    const src = [
      "declare const a: { b(): void } | undefined;",
      "declare const list: Array<{ b(): void }>;",
      "declare const i: number;",
      "declare function f(): { b(): void };",
      "const i1 = ask `p` [a?.b, list[i].b, list[0].b]: string;",
      "const i2 = ask `p` [f().b]: string;",
      "",
    ].join("\n");
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(code).toContain(
      "tools: [__nola.tool(a?.b, __nola_tool_$2(), undefined, a), __nola.tool(list[i].b, __nola_tool_$3(), undefined, list[i]), __nola.tool(list[0].b, __nola_tool_$4(), undefined, list[0])]",
    );
    expect(diagnostics.map((d) => [d.code, d.loc.start.line])).toEqual([["NOLA2018", 6]]);
    expect(diagnostics[0]?.message).toContain("name the object first");
  });

  it("tolerant: an entry the parser dropped leaves the rest of the list lowered", () => {
    const { code, diagnostics } = compileNola("declare function a(): void;\nconst i = ask `p` [a, 1]: string;\n", "x.tsi", { tolerant: true });
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1021"]);
    expect(code).toContain('tools: [__nola.tool(a, __nola_tool_$2(), "a")]');
  });

  it("is legal where an extractor is: an infer body, and NOLA2001 in a plain function", () => {
    const ok = compileNola("declare function a(): void;\ninfer function go() {\n  return ask `p` [a]: string;\n}\n", "x.tsi");
    expect(ok.diagnostics).toEqual([]);
    expect(ok.code).toContain("__nola.intents.ToolUseIntent<string>({");
    const bad = compileNola("declare function a(): void;\nfunction f() { return ask `p` [a]: string; }\n", "x.tsi");
    expect(bad.diagnostics.map((d) => d.code)).toEqual(["NOLA2001"]);
  });
});
