// biome-ignore-all lint/suspicious/noTemplateCurlyInString: .tsi fixtures and lowered output contain literal ${} interpolation
import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";
import { typecheckLowered } from "./helpers/typecheck.js";

describe("body instruction lowering (scope-bodies spec §2.3 / §5.3)", () => {
  describe("infer body — an alternate spelling of the marker", () => {
    it("prose: the first-statement literal leaves the body and becomes the instruction", () => {
      const src = ["infer function go(.q: string) {", "  `answer tersely`", "  return ask ..`v`<string>;", "}", ""].join("\n");
      const { code, diagnostics } = compileNola(src, "x.tsi");
      expect(diagnostics).toEqual([]);
      expect(code).toContain('.func({ fn: "go", instruction: "answer tersely", args: [');
      // the literal's bytes are gone from the body; only the wrapper copy remains
      expect(code.indexOf("answer tersely")).toBe(code.lastIndexOf("answer tersely"));
      expect(code).not.toContain("`answer tersely`\n");
      expect(typecheckLowered({ "x.ts": code })).toEqual([]);
    });

    it("a `${.member}` literal is the function's prompt template, copied with anchors", () => {
      const src = ["infer function go(.q: string) {", "  `${.default}\nBe terse.`", "  return ask ..`v`<string>;", "}", ""].join("\n");
      const { code, diagnostics, meta } = compileNola(src, "x.tsi");
      expect(diagnostics).toEqual([]);
      expect(code).toContain('instruction: "${.default}\\nBe terse.", template: (__nola_s) => __nola.tpl`${__nola_s.default}\nBe terse.`');
      // editor features survive the move: an anchor covers the literal's verbatim text
      const literalStart = src.indexOf("`${.default}");
      expect(meta.anchors.some((a) => a.sourceStart >= literalStart && a.sourceEnd <= literalStart + "`${.default}\nBe terse.`".length)).toBe(true);
      expect(typecheckLowered({ "x.ts": code })).toEqual([]);
    });

    it("lexical holes see the parameters", () => {
      const src = ["infer function go(.q: string, n: number) {", "  `at most ${n} words`", "  return ask ..`v`<string>;", "}", ""].join("\n");
      const { code, diagnostics } = compileNola(src, "x.tsi");
      expect(diagnostics).toEqual([]);
      expect(code).toContain("instruction: `at most ${__nola.fmt(n)} words`");
      expect(typecheckLowered({ "x.ts": code })).toEqual([]);
    });

    it("NOLA2013: a marker and a body instruction on the same function", () => {
      const src = ["infer function go`marker`(.q: string) {", "  `body`", "  return ask ..`v`<string>;", "}", ""].join("\n");
      const { diagnostics } = compileNola(src, "x.tsi");
      expect(diagnostics.map((d) => d.code)).toEqual(["NOLA2013"]);
      expect(src.slice(diagnostics[0]?.start, diagnostics[0]?.end)).toBe("`body`");
    });
  });

  describe("module body — the <module> scope's instruction", () => {
    it("prose: the literal leaves the module and lands in the module init", () => {
      const src = ["`You triage support mail.`", "export const v = ask ..`v`<string>;", ""].join("\n");
      const { code, diagnostics } = compileNola(src, "x.tsi");
      expect(diagnostics).toEqual([]);
      expect(code).toContain('module({ instruction: "You triage support mail." })');
      expect(code.indexOf("You triage support mail.")).toBe(code.lastIndexOf("You triage support mail."));
      expect(typecheckLowered({ "x.ts": code })).toEqual([]);
    });

    it("a `${.member}` literal becomes a hoisted template function in place", () => {
      const src = ["`${.default}\nBe terse.`", "const .tone = 'brief';", "export const v = ask ..`v`<string>;", ""].join("\n");
      const { code, diagnostics } = compileNola(src, "x.tsi");
      expect(diagnostics).toEqual([]);
      expect(code).toContain(
        'function __nola_module_tpl(__nola_s: import("@nola-lang/runtime").FunctionPromptScope) { return __nola.tpl`${__nola_s.default}\nBe terse.`; }',
      );
      expect(code).toContain(
        'module({ instruction: "${.default}\\nBe terse.", template: __nola_module_tpl, locals: [{ name: "tone" }] })',
      );
      expect(typecheckLowered({ "x.ts": code })).toEqual([]);
    });

    it("lexical holes read module values live, through a hoisted function", () => {
      const src = ["const n = 3;", "`at most ${n} words`", "export const v = ask ..`v`<string>;", ""].join("\n");
      // not the first statement — stays a plain (useless) expression statement
      expect(compileNola(src, "x.tsi").code).not.toContain("__nola_module_tpl");
      const first = ["`at most ${n} words`", "const n = 3;", "export const v = ask ..`v`<string>;", ""].join("\n");
      const { code, diagnostics } = compileNola(first, "x.tsi");
      expect(diagnostics).toEqual([]);
      expect(code).toContain("function __nola_module_tpl() { return `at most ${__nola.fmt(n)} words`; }");
      expect(code).toContain("module({ instruction: __nola_module_tpl() })");
      expect(typecheckLowered({ "x.ts": code })).toEqual([]);
    });

    it("a first-statement literal in a file that never asks lowers to nothing special", () => {
      const src = ["`prose`", "export const x = 1;", ""].join("\n");
      const { code, diagnostics } = compileNola(src, "x.tsi");
      expect(diagnostics).toEqual([]);
      expect(code).toBe(src);
    });
  });

  it("a template literal that is not a body's first statement is untouched, and `${.x}` in it stays NOLA2009", () => {
    const src = ["const a = 1;", "`${.default}`;", "export const v = ask ..`v`<string>;", ""].join("\n");
    const { diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA2009"]);
  });

  it("a plain function's first-statement literal is plain JavaScript", () => {
    const src = ["function f() {", "  `not an instruction`;", "  return 1;", "}", ""].join("\n");
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toBe(src);
  });
});
