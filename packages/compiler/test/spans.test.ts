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
  bodyProse: "infer function go(input: string) {\n  `do the thing`\n  return ask ..`p`;\n}\n",
  // a context statement with a hole: the item's opener and closer around the verbatim literal, the hole as written
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${...} in .tsi fixture source
  bodyHoles: "const n = 1;\ninfer function go(input: string) {\n  `${n}\nBe terse.`\n  return ask ..`p`;\n}\n",
  // inserts that share one offset (the wrapper opener and the item's; the item's closer and the wrapper's)
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${...} in .tsi fixture source
  tightHoles: "const n = 1;\ninfer function go() {`${n} x`}\n",
  // a module item: a hoisted function around the verbatim literal
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${...} in .tsi fixture source
  moduleHoles: "`at most ${n} words`\nconst n = 3;\nexport const v = ask ..`v`<string>;\n",
  // context statement seams (spec 2026-09-29 §3.3): values verbatim, a comment dropped, a parenthesized value, text → text
  contextSeams:
    "infer function go(user: string) {\n  `Analyze` /* who */ user\n  `now` (user.length) `chars`\n  `cost $``{x}`;\n  return ask ..`v`<string>;\n}\n",
  // a call intent as the last value, glued to the closing brace: its `)` rewrite, then the closers, then the wrapper's
  contextCallIntentLast: "declare function foo(a: string): void;\ninfer function go() {`x` foo(..`a`<string>)}\n",
  // an item glued to an exported type: the type's value insert and the item's opener share one offset
  contextGluedType: "export type T = { a: string };`text`\nexport const v = ask ..`v`<string>;\n",
  tightProse: "infer function go() {`x`;}\n",
  adjacentAsk: "declare function log(a: string): void;\ninfer function go() {\n  `be terse`;ask log(..`x`<string>);\n}\n",
  emptyBody: "infer function go() {}\n",
  callIntent:
    'declare function tool(a: string): Promise<number>;\ninfer function go() {\n  return ask tool``("x");\n}\n',
  sigilLessCallIntent:
    'declare function tool(a: string, b: number): Promise<number>;\ninfer function go() {\n  return ask tool(..`x`<string>, 2);\n}\n',
  // implied sigil in a slot (spec 2026-09-30): the prefix insert coalesces with the args-head overwrite
  // for the first argument, and lands inside verbatim text for a later or nested one
  impliedSlot:
    "declare function tool(a: string, o: { n: number }): Promise<number>;\ninfer function go() {\n  return ask tool(`x`: string, { n: `count`<number> });\n}\n",
  // implied sigil: the extractor prefix is an insert at the template start, coalesced with `ask `
  impliedExtract: "infer function go() {\n  return ask `get a name`<string>;\n}\n",
  impliedExtractModule: "const n = ask with fast `hi`;\n",
  // emit 14: the value insert after an exported type is a zero-source-length replaced span
  typeValues: "export type P = { x: number };\nexport const s = P.toJsonSchema();\n",
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
