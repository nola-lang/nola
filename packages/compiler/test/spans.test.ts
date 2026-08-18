import { compileNola, type Span } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";

function assertSpanInvariants(source: string, code: string, spans: Span[]): void {
  let gen = 0;
  let src = 0;
  for (const sp of spans) {
    expect(sp.generatedStart).toBe(gen); // tiling: no gaps, no overlap
    expect(sp.generatedEnd).toBeGreaterThanOrEqual(sp.generatedStart);
    gen = sp.generatedEnd;
    expect(sp.sourceStart).toBeGreaterThanOrEqual(src); // source side ascending
    expect(sp.sourceEnd).toBeGreaterThanOrEqual(sp.sourceStart);
    src = sp.sourceEnd;
    if (sp.kind === "verbatim") {
      expect(code.slice(sp.generatedStart, sp.generatedEnd)).toBe(source.slice(sp.sourceStart, sp.sourceEnd));
    }
    if (sp.kind === "appendix") {
      expect(sp).toBe(spans[spans.length - 1]);
      expect(sp.sourceStart).toBe(source.length);
      expect(sp.sourceEnd).toBe(source.length);
    }
  }
  expect(gen).toBe(code.length); // generated fully covered
  expect(src).toBe(source.length); // source fully covered
}

const FIXTURES: Record<string, string> = {
  plain: "export const x: number = 1;\n",
  extract: "const i = ..`get a name`<string>;\n",
  extractInterp:
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${...} in .tsi fixture source
    "infer function go(input: string) {\n  return ask ..`extract ${input} now`<string>;\n}\n",
  askWith: "infer function go() {\n  return ask with fast ..`hi`;\n}\n",
  marker: "infer function go`do the thing`(input: string) {\n  return ask ..`p`;\n}\n",
  callIntent:
    'declare function tool(a: string): Promise<number>;\ninfer function go() {\n  return ask tool``("x");\n}\n',
  sigilLessCallIntent:
    'declare function tool(a: string, b: number): Promise<number>;\ninfer function go() {\n  return ask tool(..`x`<string>, 2);\n}\n',
};

describe("meta.spans", () => {
  for (const [name, source] of Object.entries(FIXTURES)) {
    it(`satisfies the span invariants: ${name}`, () => {
      const r = compileNola(source, "t.tsi");
      expect(r.diagnostics).toEqual([]);
      assertSpanInvariants(source, r.code, r.meta.spans);
    });
  }

  it("a plain TS file is one whole-file verbatim span", () => {
    const r = compileNola(FIXTURES.plain as string, "t.tsi");
    expect(r.meta.spans).toEqual([
      {
        sourceStart: 0,
        sourceEnd: (FIXTURES.plain as string).length,
        generatedStart: 0,
        generatedEnd: (FIXTURES.plain as string).length,
        kind: "verbatim",
      },
    ]);
  });

  it("a lowered file ends with the appendix span", () => {
    const r = compileNola(FIXTURES.extract as string, "t.tsi");
    expect(r.meta.spans.at(-1)?.kind).toBe("appendix");
  });

  it("the strict-mode bail path emits one whole-file verbatim span", () => {
    const broken = "const p = ..5;\n";
    const r = compileNola(broken, "t.tsi");
    expect(r.code).toBe(broken);
    expect(r.meta.spans).toEqual([
      { sourceStart: 0, sourceEnd: broken.length, generatedStart: 0, generatedEnd: broken.length, kind: "verbatim" },
    ]);
    expect(r.meta.anchors).toEqual([]);
  });
});

describe("meta.anchors", () => {
  it("the extractor's <T> text is anchored: same bytes, feature-mapped into the generated call", () => {
    const source = [
      "type Person = { name: string };",
      "export infer function extractPerson(text: string) {",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${...} in .tsi fixture source
      "  const person = ask ..`the person described in: ${text}`<Person>;",
      "  return person;",
      "}",
      "",
    ].join("\n");
    const r = compileNola(source, "t.tsi");
    expect(r.diagnostics).toEqual([]);
    expect(r.meta.anchors).toHaveLength(1);
    const a = r.meta.anchors[0] as (typeof r.meta.anchors)[0];
    expect(source.slice(a.sourceStart, a.sourceEnd)).toBe("Person");
    expect(r.code.slice(a.generatedStart, a.generatedEnd)).toBe("Person");
    // the generated copy sits inside the ExtractIntent type argument
    expect(r.code.slice(a.generatedStart - "ExtractIntent<".length, a.generatedEnd + 1)).toBe(
      "ExtractIntent<Person>",
    );
  });

  it("anchors carry complex type text and one entry per extractor", () => {
    const source = [
      "type P = { name: string };",
      "const a = ..`xs`<P[]>;",
      "const b = ..`n`<number>;",
      "const c = ..`untyped`;",
      "",
    ].join("\n");
    const r = compileNola(source, "t.tsi");
    expect(r.diagnostics).toEqual([]);
    expect(r.meta.anchors).toHaveLength(2);
    const texts = r.meta.anchors.map((x) => source.slice(x.sourceStart, x.sourceEnd));
    expect(texts).toEqual(["P[]", "number"]);
    for (const x of r.meta.anchors) {
      expect(r.code.slice(x.generatedStart, x.generatedEnd)).toBe(source.slice(x.sourceStart, x.sourceEnd));
    }
  });
});
