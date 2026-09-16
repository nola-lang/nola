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
    expect(code).toContain("__nola.useRuntime(16);");
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

describe("extractor prompt templates (${.member})", () => {
  it("lowers a scope-hole extractor to instruction string + template closure, in place", () => {
    const src = "infer function go(a: string) {\n  const v = ask ..`type: ${.type} for ${a}`<string>;\n  return v;\n}\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain(
      `await __nola.ask(__nola.intents.ExtractIntent<string>({ instruction: "type: \${.type} for \${a}", template: (__nola_s) => __nola.tpl\`type: \${__nola_s.type} for \${a}\`, type: __nola_type_$2(), loc: "2:17", def: "${defHash("x.tsi", "extract", "type: ${.type} for ${a}", "string")}" }), __frame)`,
    );
    // a lexical hole inside a template is NOT fmt-wrapped (tpl formats)
    expect(code).not.toContain("__nola.fmt(a)");
  });

  it("nested scope holes and keyword members are prefixed too", () => {
    const src = "const v = ..`${.default}\n${[1].map(n => `${n} ${.type}`)}`;\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain("__nola.tpl`${__nola_s.default}\n${[1].map(n => `${n} ${__nola_s.type}`)}`");
  });

  it("a lexical-only extractor is unchanged (fmt-wrapped, no template)", () => {
    const src = "infer function go(a: string) {\n  const v = ask ..`v from ${a}`<string>;\n  return v;\n}\n";
    const { code } = compileNola(src, "x.tsi");
    expect(code).toContain("instruction: `v from ${__nola.fmt(a)}`, type:");
    expect(code).not.toContain("template:");
  });

  it("NOLA2009: scope access in a plain template literal", () => {
    const { code, diagnostics } = compileNola("const s = `x ${.type}`;\n", "x.tsi", { tolerant: true });
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA2009"]);
    expect(code).toContain("`x ${(undefined as never)}`");
  });
});
