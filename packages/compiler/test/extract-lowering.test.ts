// biome-ignore-all lint/suspicious/noTemplateCurlyInString: .tsi fixtures and lowered output contain literal ${} interpolation
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";
import { defHash } from "../src/lower/templates.js";

describe("extract lowering v2", () => {
  it("lowers a typed extractor to an ExtractIntent factory call", () => {
    const { code, diagnostics } = compileNola("const i = ..`ticket id`<string>;\n", "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain(
      `__nola.intents.ExtractIntent<string>({ instruction: \`ticket id\`, type: __nola_type_$1(), loc: "1:11", def: "${defHash("x.tsi", "extract", "ticket id", "string")}" })`,
    );
    expect(code).toContain('import { __nola } from "@nola-lang/runtime";');
    expect(code).toContain("__nola.useRuntime(21);");
  });

  it("wraps each ${} substitution in __nola.fmt and keeps the template", () => {
    const { code, diagnostics } = compileNola(
      "const m = 1;\nconst i = ..`user ${m} from ${m + 1}`<string>;\n",
      "x.tsi",
    );
    expect(diagnostics).toEqual([]);
    expect(code).toContain("`user ${__nola.fmt(m)} from ${__nola.fmt(m + 1)}`");
  });

  it("an untyped extractor stays <any> with a string schema", () => {
    const { code } = compileNola("const i = ..`free text`;\n", "x.tsi");
    expect(code).toContain("__nola.intents.ExtractIntent<any>({ instruction: `free text`, type: __nola.types.string()");
  });

  it("the implied form lowers to the same ExtractIntent call as the `..` form (loc aside)", () => {
    const bare = compileNola("infer function f() {\n  return ask `ticket id`<string>;\n}\n", "x.tsi");
    const sigil = compileNola("infer function f() {\n  return ask ..`ticket id`<string>;\n}\n", "x.tsi");
    expect(bare.diagnostics).toEqual([]);
    const stripLoc = (code: string) => code.replace(/loc: "\d+:\d+"/g, 'loc: ""');
    expect(stripLoc(bare.code)).toBe(stripLoc(sigil.code));
    expect(bare.code).toContain('loc: "2:14"'); // the backtick, 1-based col
    // same def as the .. form: the hash never saw the sigil
    expect(bare.code).toContain(`def: "${defHash("x.tsi", "extract", "ticket id", "string")}"`);
  });

  it("a typed template literal outside `ask` and outside a call's slots is NOLA2014 with the `..` fix", () => {
    const { diagnostics } = compileNola(
      "declare function f(a: string): Promise<void>;\ninfer function go() {\n  const i = `x`<string>;\n  return ask f((`y`<string>));\n}\n",
      "x.tsi",
    );
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA2014", "NOLA2014"]);
    expect(diagnostics[0]?.message).toContain("..`");
    expect(diagnostics[0]?.message).toContain("call's argument list");
    expect(diagnostics.map((d) => d.loc.start.line)).toEqual([3, 4]);
  });

  it("a typed template in a call's slot is an extractor with the `..` implied (spec 2026-09-30)", () => {
    const { code, diagnostics } = compileNola(
      "declare function f(a: string): Promise<void>;\ninfer function go() {\n  return ask f(`x`<string>);\n}\n",
      "x.tsi",
    );
    expect(diagnostics).toEqual([]);
    expect(code).toContain("args: [__nola.intents.ExtractIntent<string>({ instruction: `x`");
  });

  it("the implied form at module level and under `ask with`", () => {
    const { code, diagnostics } = compileNola("const a = ask with fast `free text`;\n", "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain(
      "await __nola.ask(__nola.intents.ExtractIntent<any>({ instruction: `free text`, type: __nola.types.string()",
    );
    expect(code).toContain('"fast"');
  });

  it("appends the runtime import at end of file exactly once", () => {
    const src = "const a = ..`one`;\nconst b = ..`two`;\n";
    const { code } = compileNola(src, "x.tsi");
    const idx = code.indexOf('import { __nola } from "@nola-lang/runtime";');
    expect(idx).toBeGreaterThan(code.indexOf("const b"));
    expect(code.lastIndexOf("import { __nola }")).toBe(idx);
  });

  it("maps lowered spans back to the original extractor (source-map round trip)", () => {
    const src = "const keep = 1;\nconst name = ..`user name`;\n";
    const { code, map } = compileNola(src, "x.tsi");
    const tracer = new TraceMap(map as never);
    const lines = code.split("\n");
    const loweredLine = lines.findIndex((l) => l.includes("__nola.intents.ExtractIntent")) + 1;
    const loweredCol = lines[loweredLine - 1]?.indexOf("__nola.intents.ExtractIntent") ?? 0;
    const orig = originalPositionFor(tracer, { line: loweredLine, column: loweredCol });
    expect(orig.line).toBe(2);
    expect(orig.column).toBe(13); // 0-based col of `..`
    const keepPos = originalPositionFor(tracer, { line: 1, column: 6 });
    expect(keepPos).toMatchObject({ line: 1, column: 6 });
  });
});

describe("`${.member}` in an extractor no longer parses (spec 2026-09-28-instruction-interpolation §3.5)", () => {
  it("strict: the ordinary syntax error and nothing lowered", () => {
    const { diagnostics } = compileNola("const v = ..`type: ${.type}`<string>;\n", "x.tsi");
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1001"]);
  });

  it("a lexical extractor is unchanged: fmt-wrapped, no template field", () => {
    const src = "infer function go(a: string) {\n  const v = ask ..`v from ${a}`<string>;\n  return v;\n}\n";
    const { code } = compileNola(src, "x.tsi");
    expect(code).toContain("instruction: `v from ${__nola.fmt(a)}`, type:");
    expect(code).not.toContain("template:");
  });
});
