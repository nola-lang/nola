import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";
import { typecheckLowered } from "./helpers/typecheck.js";

const IMPORT = 'import type { Choice, Prob, Scale } from "@nola-lang/runtime";';

describe("intrinsic decision types: the appendix import", () => {
  it("imports exactly the names the file uses, sorted, after the __nola import", () => {
    const src = [
      'type Triage = { department: Choice<{ a: "A"; b: null }>; mood: Scale<["x", "y"]>; urgent: Prob };',
      "const i = ..`triage`<Triage>;",
      "",
    ].join("\n");
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain(`import { __nola } from "@nola-lang/runtime";\n${IMPORT}\n__nola.useRuntime(18);`);
    // the body is untouched: the type alias line (a verbatim span) is byte-identical
    expect(code.startsWith(src.split("\n")[0] as string)).toBe(true);
  });

  it("imports only what is used", () => {
    const { code } = compileNola("const p = ..`p`<Prob>;\n", "x.tsi");
    expect(code).toContain('import type { Prob } from "@nola-lang/runtime";');
    expect(code).not.toContain("Choice");
  });

  it("a file that declares or imports the name keeps its own", () => {
    const local = "type Choice<T> = { mine: T };\nconst i = ..`i`<Choice<string>>;\n";
    expect(compileNola(local, "x.tsi").code).not.toContain("import type {");
    const imported = 'import type { Scale } from "./scale.js";\nconst i = ..`i`<Scale<["a", "b"]>>;\n';
    expect(compileNola(imported, "x.tsi").code).not.toContain('import type { Scale } from "@nola-lang/runtime"');
  });

  it("a file with no decision type is byte-identical to before", () => {
    const { code } = compileNola("const i = ..`i`<string>;\n", "x.tsi");
    expect(code).not.toContain("import type {");
  });

  it("a type-only file that uses Choice still gets the appendix (the import needs it)", () => {
    const { code } = compileNola('export type D = Choice<"a" | "b">;\n', "x.tsi");
    expect(code).toContain('import type { Choice } from "@nola-lang/runtime";');
    expect(code).toContain("__nola.useRuntime(18);");
  });

  it("the lowered output type-checks with no import in the source", () => {
    const src = [
      'type Triage = { department: Choice<{ a: "A"; b: null }>; mood: Scale<["x", "y"]>; urgent: Prob };',
      "export infer function triage(.ticket: string) {",
      "  const t = ask ..`triage`<Triage>;",
      '  const label: "a" | "b" = t.department.choice;',
      "  const n: number = t.mood.score + t.urgent;",
      "  return { label, n };",
      "}",
      "",
    ].join("\n");
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(typecheckLowered({ "x.ts": code })).toEqual([]);
  });
});
