import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";
import { typecheckLowered } from "./helpers/typecheck.js";

const slice = (code: string, r: { start: number; end: number } | undefined) => code.slice(r?.start, r?.end);

describe("..choice / ..scale / ..prob lowering", () => {
  it("wraps the type argument, anchors the copy, pads the derivation range", () => {
    const src = 'const d = ..choice`Which team?`<{ billing: "Payments"; sales: null }>;\n';
    const { code, diagnostics, meta } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain(
      '__nola.intents.ExtractIntent<Choice<{ billing: "Payments"; sales: null }>>({ instruction: `Which team?`, type: __nola_type_$1(), loc: "1:11"',
    );
    const [req] = meta.derivations;
    expect(slice(src, req?.source)).toBe('{ billing: "Payments"; sales: null }');
    expect(slice(code, req?.lowered)).toBe('Choice<{ billing: "Payments"; sales: null }>');
    const anchor = meta.anchors.find((a) => a.sourceStart === req?.source.start);
    expect(anchor && code.slice(anchor.generatedStart, anchor.generatedEnd)).toBe(
      '{ billing: "Payments"; sales: null }',
    );
  });

  it("scale and prob with an argument", () => {
    const { code, meta } = compileNola(
      'const a = ..scale`How bad?`<["low", "high"]>;\nconst c = ..prob`Urgent?`<{ true: "y"; false: "n" }>;\n',
      "x.tsi",
    );
    expect(code).toContain('ExtractIntent<Scale<["low", "high"]>>(');
    expect(code).toContain('ExtractIntent<Prob<{ true: "y"; false: "n" }>>(');
    expect(meta.derivations.map((r) => slice(code, r.lowered))).toEqual([
      'Scale<["low", "high"]>',
      'Prob<{ true: "y"; false: "n" }>',
    ]);
  });

  it("bare ..prob needs no derivation", () => {
    const { code, meta, diagnostics } = compileNola("const p = ..prob`Urgent?`;\n", "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain("ExtractIntent<Prob>({ instruction: `Urgent?`, type: __nola.types.prob(), loc:");
    expect(meta.derivations).toEqual([]);
    expect(code).toContain('import type { Prob } from "@nola-lang/runtime";');
  });

  it("the sugar and the long-hand spelling share the def", () => {
    const sugar = compileNola("const d = ..choice`q`<{ a: null; b: null }>;\n", "x.tsi").code;
    const long = compileNola("const d = ..`q`<Choice<{ a: null; b: null }>>;\n", "x.tsi").code;
    const defOf = (code: string) => /def: "([0-9a-f]+)"/.exec(code)?.[1];
    expect(defOf(sugar)).toBeDefined();
    expect(defOf(sugar)).toBe(defOf(long));
  });

  it("..choice / ..scale without a type argument is NOLA2015 at the extractor, lowered with the default type", () => {
    const { code, diagnostics } = compileNola("const d = ..choice`q`;\n", "x.tsi");
    expect(diagnostics.map((d) => [d.code, d.message])).toEqual([
      [
        "NOLA2015",
        '`..choice` needs a criteria type argument — write ..choice`…`<{ label: "description" }> or ..choice`…`<"a" | "b">.',
      ],
    ]);
    expect(code).toContain("ExtractIntent<any>({");
    const scale = compileNola("const s = ..scale`q`;\n", "x.tsi");
    expect(scale.diagnostics.map((d) => d.message)).toEqual([
      '`..scale` needs a levels type argument — write ..scale`…`<["low", "high"]>.',
    ]);
  });

  it("the lowered output type-checks", () => {
    const src = [
      "export infer function f(.t: string) {",
      '  const d = ask ..choice`q`<{ a: "A"; b: null }>;',
      '  const s = ask ..scale`q`<["x", "y"]>;',
      "  const p = ask ..prob`q`;",
      "  return { label: d.choice, score: s.score, p: p * 2 };",
      "}",
      "",
    ].join("\n");
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(typecheckLowered({ "x.ts": code })).toEqual([]);
  });
});
