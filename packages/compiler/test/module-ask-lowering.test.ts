// biome-ignore-all lint/suspicious/noTemplateCurlyInString: .tsi fixtures and lowered output contain literal ${} interpolation
import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";
import { defHash } from "../src/lower/templates.js";
import { typecheckLowered } from "./helpers/typecheck.js";

describe("module-body ask lowering (scope-bodies spec §5)", () => {
  it("lowers a top-level ask against the hoisted module scope accessor", () => {
    const src = "const mail = 'hi';\nexport const label = ask ..`label for ${mail}`<string>;\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toBe(
      [
        "const mail = 'hi';",
        `export const label = await __nola.ask(__nola.intents.ExtractIntent<string>({ instruction: \`label for \${__nola.fmt(mail)}\`, type: __nola_type_$1(), loc: "2:26", def: "${defHash("x.tsi", "extract", "label for ${mail}", "string")}" }), __nola_module_ctx());`,
        "",
        ";",
        'import { __nola } from "@nola-lang/runtime";',
        "__nola.useRuntime(18);",
        'function __nola_file_ctx() { return __nola.context.file("x.tsi", 18); }',
        "function __nola_module_ctx() { return __nola_file_ctx().module({}); }",
        'function __nola_type_$1(): import("@nola-lang/runtime").InferType<unknown> { return (undefined as never); }',
        "",
      ].join("\n"),
    );
  });

  it("stays legal through top-level blocks, loops and try", () => {
    const src = [
      "const out: string[] = [];",
      "for (const m of ['a', 'b']) {",
      "  try {",
      "    if (m) out.push(ask ..`label for ${m}`<string>);",
      "  } catch {}",
      "}",
      "",
    ].join("\n");
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain("}), __nola_module_ctx()));");
  });

  it("a file whose module body never asks gets no module accessor", () => {
    const src = "infer function go() {\n  return ask ..`v`<string>;\n}\n";
    expect(compileNola(src, "x.tsi").code).not.toContain("__nola_module_ctx");
  });

  it("an infer-body ask in the same file still closes over __frame", () => {
    const src = "infer function go() {\n  return ask ..`v`<string>;\n}\nconst top = ask go();\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain("}), __frame);");
    expect(code).toContain("const top = await __nola.ask(go(), __nola_module_ctx());");
  });

  it("lowered module-body asks are tsc-clean under strict, and the result types flow", () => {
    const src = [
      "infer function go(.q: string) {",
      "  return ask ..`v`<number>;",
      "}",
      "const n: number = ask go('x');",
      "const s: string = ask (..`s`<string>).withTimeout(1_000);",
      "export { n, s };",
      "",
    ].join("\n");
    const { code, diagnostics } = compileNola(src, "top.tsi");
    expect(diagnostics).toEqual([]);
    expect(typecheckLowered({ "top.ts": code })).toEqual([]);
  });
});
