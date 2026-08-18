import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";
import { typecheckLowered } from "./helpers/typecheck.js";

const SRC = ["infer function go() {", "  const v = ask with fast ..`v`<string>;", "  return v;", "}", ""].join("\n");

describe("ask with <identifier> lowering", () => {
  it("passes the alias as the third ask argument", () => {
    const { code, diagnostics } = compileNola(SRC, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain(
      "await __nola.ask(__nola.intents.ExtractIntent<string>({ instruction: `v`, " +
        'type: __nola.types.string(), loc: "2:27" }), __frame, "fast");',
    );
  });

  it("lowers a keyword-named alias (`default`) like any other name", () => {
    const src = "infer function go() {\n  const v = ask with default ..`v`<string>;\n  return v;\n}\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain('__frame, "default");');
  });

  it("routes a stored-intent operand through the alias", () => {
    const src = "infer function go(i: unknown) {\n  return ask with fast i;\n}\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain('await __nola.ask(i, __frame, "fast")');
  });

  it("plain ask keeps the two-argument ask call", () => {
    const src = "infer function go() {\n  return ask ..`v`<string>;\n}\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toMatch(/__nola\.ask\(.*, __frame\);/);
  });

  it("NOLA2001: ask with alias outside an infer function body", () => {
    const { diagnostics } = compileNola("const v = ask with fast ..`v`;\n", "x.tsi");
    expect(diagnostics.map((d) => d.code)).toContain("NOLA2001");
  });

  it("lowered ask-with output is tsc-clean under strict", () => {
    const { code, diagnostics } = compileNola(SRC, "with.tsi");
    expect(diagnostics).toEqual([]);
    expect(typecheckLowered({ "with.ts": code })).toEqual([]);
  });
});
