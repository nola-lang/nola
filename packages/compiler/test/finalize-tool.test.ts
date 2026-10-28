import { compileNola, finalizeDerivations } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";

const SRC = "declare function a(x: string): void;\nconst i = ask `p` [a]: string;\n";
const answerType = { accessor: "__nola_type_$1", ok: true as const, expr: "__nola.types.string()", accessors: [], imports: [], deps: [] };

// Tool requests (spec 2026-10-08 §3.4, entries by value 2026-10-09 §3.4): the
// answer is one object carrier over the function's parameters, or a group
// verdict (`__nola.tools.*`); the accessor is typed as a verdict. A failure
// is an error at the entry — NOLA2018 when the walk says the value is neither
// a function nor a group, NOLA2002 for an underivable parameter — with an
// evaluable fallback body, like an extractor's.
describe("finalizeDerivations — tool requests", () => {
  it("an answered tool request becomes a verdict accessor", () => {
    const p1 = compileNola(SRC, "/proj/src/m.tsi", { sourceRoot: "/proj" });
    const done = finalizeDerivations(p1, [
      answerType,
      {
        accessor: "__nola_tool_$2",
        ok: true,
        expr: '__nola.types.object({ x: __nola.types.string() }).describe("A tool.")',
        accessors: [],
        imports: [],
        deps: [],
      },
    ]);
    expect(done.diagnostics).toEqual([]);
    expect(done.code).toContain(
      'function __nola_tool_$2(): import("@nola-lang/runtime").ToolVerdict { return __nola.types.object({ x: __nola.types.string() }).describe("A tool."); }',
    );
  });

  it("finalize reports a spread's member and a written entry with one name, across two lists, once at the later entry", () => {
    // the ask sequence (spec 2026-10-12 §3.4): every list of an ask shares one name space
    const src =
      "declare const fileTools: { search(q: string): string[] };\ndeclare function search(q: string): string[];\nconst f = ask `a` [...fileTools] `or` [search]: string[];\n";
    const p1 = compileNola(src, "/proj/src/m.tsi", { sourceRoot: "/proj" });
    expect(p1.diagnostics).toEqual([]);
    const tools = p1.meta.derivations.filter((d) => d.kind === "tool");
    expect(tools.map((d) => d.tool)).toEqual([expect.objectContaining({ spread: true }), expect.objectContaining({ written: "search" })]);
    expect(new Set(tools.map((d) => d.tool?.ask)).size).toBe(1);
    const done = finalizeDerivations(p1, [
      { accessor: "__nola_type_$1", ok: true, expr: "__nola.types.array(__nola.types.string())", accessors: [], imports: [], deps: [] },
      {
        accessor: tools[0]?.accessor ?? "",
        ok: true,
        expr: "__nola.tools.members({ search: __nola.types.object({ q: __nola.types.string() }) })",
        names: ["search"],
        accessors: [],
        imports: [],
        deps: [],
      },
      {
        accessor: tools[1]?.accessor ?? "",
        ok: true,
        expr: "__nola.types.object({ q: __nola.types.string() })",
        names: ["search"],
        accessors: [],
        imports: [],
        deps: [],
      },
    ]);
    expect(done.diagnostics.map((d) => [d.code, src.slice(d.start, d.end)])).toEqual([["NOLA2018", "search"]]);
    expect(done.diagnostics[0]?.message).toContain("offered twice");
  });

  it("a non-callable entry is NOLA2018 at the entry; an underivable parameter is NOLA2002", () => {
    const p1 = compileNola(SRC, "/proj/src/m.tsi", { sourceRoot: "/proj" });
    const notCallable = finalizeDerivations(p1, [
      answerType,
      { accessor: "__nola_tool_$2", ok: false, reason: "a is not callable", code: "NOLA2018", accessors: [], deps: [] },
    ]);
    expect(notCallable.diagnostics.map((d) => [d.code, d.message, d.loc.start.line, d.loc.start.column])).toEqual([
      ["NOLA2018", "a is not callable", 2, 19],
    ]);
    expect(notCallable.code).toContain(
      'function __nola_tool_$2(): import("@nola-lang/runtime").ToolVerdict { return __nola.types.object({}); }',
    );
    const underivable = finalizeDerivations(p1, [
      answerType,
      { accessor: "__nola_tool_$2", ok: false, reason: "unsupported type Map<string, number> at parameter 'x' of a", accessors: [], deps: [] },
    ]);
    expect(underivable.diagnostics.map((d) => [d.code, d.loc.start.column])).toEqual([["NOLA2002", 19]]);
    expect(underivable.diagnostics[0]?.message).toContain("Map<string, number>");
  });

  it("a group answer is a verdict accessor; a failed spread falls back to an empty tuple", () => {
    const src = "declare const g: { a(x: string): void };\nconst i = ask `p` [...g]: string;\n";
    const p1 = compileNola(src, "/proj/src/m.tsi", { sourceRoot: "/proj" });
    const ok = finalizeDerivations(p1, [
      answerType,
      {
        accessor: "__nola_tool_$2",
        ok: true,
        expr: "__nola.tools.members({ a: __nola.types.object({ x: __nola.types.string() }) })",
        names: ["a"],
        accessors: [],
        imports: [],
        deps: [],
      },
    ]);
    expect(ok.diagnostics).toEqual([]);
    expect(ok.code).toContain(
      'function __nola_tool_$2(): import("@nola-lang/runtime").ToolVerdict { return __nola.tools.members({ a: __nola.types.object({ x: __nola.types.string() }) }); }',
    );
    const failed = finalizeDerivations(p1, [
      answerType,
      { accessor: "__nola_tool_$2", ok: false, reason: "g has no functions", code: "NOLA2018", accessors: [], deps: [] },
    ]);
    expect(failed.diagnostics.map((d) => d.code)).toEqual(["NOLA2018"]);
    expect(failed.code).toContain("return __nola.tools.tuple([]); }");
  });

  it("names two entries of one ask declare collide → NOLA2018 at the later entry", () => {
    const src = "declare function search(q: string): void;\ndeclare const g: { search(q: string): void };\nconst i = ask `p` [search, ...g]: string;\n";
    const p1 = compileNola(src, "/proj/src/m.tsi", { sourceRoot: "/proj" });
    const carrier = "__nola.types.object({ q: __nola.types.string() })";
    const done = finalizeDerivations(p1, [
      answerType,
      { accessor: "__nola_tool_$2", ok: true, expr: carrier, names: ["search"], accessors: [], imports: [], deps: [] },
      {
        accessor: "__nola_tool_$3",
        ok: true,
        expr: `__nola.tools.members({ search: ${carrier} })`,
        names: ["search"],
        accessors: [],
        imports: [],
        deps: [],
      },
    ]);
    // at the spread's ARGUMENT (`g`, column 30): the request's range is where the type is read and where the fix goes
    expect(done.diagnostics.map((d) => [d.code, d.loc.start.line, d.loc.start.column])).toEqual([["NOLA2018", 3, 30]]);
    expect(done.diagnostics[0]?.message).toContain("'search' is offered twice");
  });

  it("two written single entries are the lowerer's collision, reported once", () => {
    const src = "declare function a(): void;\nconst i = ask `p` [a, a]: string;\n";
    const p1 = compileNola(src, "/proj/src/m.tsi", { sourceRoot: "/proj" });
    expect(p1.diagnostics.map((d) => d.code)).toEqual(["NOLA2018"]);
    const carrier = "__nola.types.object({})";
    const done = finalizeDerivations(p1, [
      answerType,
      { accessor: "__nola_tool_$2", ok: true, expr: carrier, names: ["a"], accessors: [], imports: [], deps: [] },
      { accessor: "__nola_tool_$3", ok: true, expr: carrier, names: ["a"], accessors: [], imports: [], deps: [] },
    ]);
    expect(done.diagnostics.map((d) => d.code)).toEqual(["NOLA2018"]);
  });
});
