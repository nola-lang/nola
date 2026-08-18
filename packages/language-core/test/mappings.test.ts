import { compileNola } from "@nola-lang/compiler";
import { spansToMappings } from "@nola-lang/language-core";
import { defaultMapperFactory } from "@volar/language-core";
import { describe, expect, it } from "vitest";

describe("spansToMappings", () => {
  it("verbatim spans map with full features, replaced with verification only, appendix dropped", () => {
    const src = "type U = { n: string };\nconst i = ..`x`<U>;\n";
    const { meta } = compileNola(src, "x.tsi");
    const mappings = spansToMappings(meta.spans);
    // one mapping per span (single-segment): the span counts, not one packed
    // mapping per kind
    const verbatimCount = meta.spans.filter((s) => s.kind === "verbatim").length;
    const replacedCount = meta.spans.filter((s) => s.kind === "replaced").length;
    expect(mappings).toHaveLength(verbatimCount + replacedCount);
    for (const m of mappings) expect(m.sourceOffsets).toHaveLength(1);

    const verbatim = mappings.filter((m) => m.data.semantic);
    const replaced = mappings.filter((m) => !m.data.semantic);
    expect(verbatim).toHaveLength(verbatimCount);
    expect(replaced).toHaveLength(replacedCount);
    expect(verbatim[0]?.data).toMatchObject({ verification: true, completion: true, navigation: true, semantic: true });
    // format is false on generated-side mappings: lowered infer bodies are
    // nested one level deeper than the source, so TS-formatter indentation on
    // the lowered text would map back double-indented. Source formatting runs
    // through the root code's format-only identity mapping instead.
    expect(verbatim[0]?.data.format).toBe(false);
    expect(replaced[0]?.data).toEqual({ verification: true });
    // replaced spans have independent generated lengths
    expect(replaced[0]?.generatedLengths).toHaveLength(1);
  });

  it("verbatim mapping segments are byte-consistent with the spans", () => {
    const src = "const keep = 1;\nconst i = ..`x`<string>;\n";
    const { code, meta } = compileNola(src, "x.tsi");
    const mappings = spansToMappings(meta.spans);
    for (const m of mappings.filter((x) => x.data.semantic)) {
      const s = m.sourceOffsets[0] as number;
      const g = m.generatedOffsets[0] as number;
      const l = m.lengths[0] as number;
      expect(code.slice(g, g + l)).toBe(src.slice(s, s + l));
    }
  });

  it("a plain TS file yields one whole-file verbatim mapping", () => {
    const src = "export const x = 1;\n";
    const { meta } = compileNola(src, "x.tsi");
    const mappings = spansToMappings(meta.spans, meta.anchors);
    expect(mappings).toHaveLength(1);
    expect(mappings[0]?.sourceOffsets).toEqual([0]);
    expect(mappings[0]?.lengths).toEqual([src.length]);
  });

  it("a generated range ending at a deletion does not swallow the deleted source", () => {
    // The tagged header `name`instruction`(...)` deletes the instruction from
    // the lowered text, so ONE generated offset (the end of the name) is two
    // source offsets: the name's end and the `(`'s start. Volar translates a
    // range's end by binary-searching the matched mapping's offset arrays — so
    // if every verbatim span shares one mapping, the end can land on the NEXT
    // span's start and the token stretches across the deleted instruction
    // (a `function` semantic token painting the prose). One mapping per span
    // confines the end to the span its start matched.
    const src = "export infer function go`prose here`(q: string) {\n  return 1\n}\n";
    const { code, meta } = compileNola(src, "x.tsi");
    const mapper = defaultMapperFactory(spansToMappings(meta.spans, meta.anchors, code));

    const genStart = code.indexOf("go");
    const [mapped] = [...mapper.toSourceRange(genStart, genStart + "go".length, true)];
    expect(mapped).toBeDefined();
    const [sourceStart, sourceEnd] = mapped as [number, number];
    expect(src.slice(sourceStart, sourceEnd)).toBe("go");
  });

  it("the cursor right after a half-typed `..` marker has no completion-enabled mapping", () => {
    // Volar matches a source position against a mapping when it lies anywhere
    // in [start, start + length] — ENDS included. So a marker span that stops
    // at the cursor does not hide it: the next verbatim span starts there and
    // hands TypeScript a position it happily answers with the global scope
    // (TS's isValidTrigger returns true for "." unconditionally). The mapping
    // for the character after a broken construct therefore has to opt out of
    // completion itself.
    const src = "infer function go() {\n  const x = ask ..\n  return x;\n}\n";
    const { code, meta } = compileNola(src, "x.tsi", { tolerant: true });
    const mapper = defaultMapperFactory(spansToMappings(meta.spans, meta.anchors, code));

    const cursor = src.indexOf("ask ..") + "ask ..".length;
    const completable = [...mapper.toGeneratedLocation(cursor)].filter(([, m]) => m.data.completion);
    expect(completable).toEqual([]);

    // ...and only that seam: ordinary code one line down still completes
    const ordinary = src.indexOf("return x;") + "return ".length;
    expect([...mapper.toGeneratedLocation(ordinary)].filter(([, m]) => m.data.completion)).not.toEqual([]);
  });

  it("anchors map the extractor's <T> text with full features and PRECEDE the replaced mapping", () => {
    // Order is load-bearing: range translation is first-match in mapping
    // order, so the anchor's precise translation must come before the
    // replaced span's clamped one — that is what puts a TS2304 on the exact
    // <T> range (and with it, the import quick fix at the cursor).
    const src = "type U = { n: string };\nconst i = ..`x`<U>;\n";
    const { code, meta } = compileNola(src, "x.tsi");
    const mappings = spansToMappings(meta.spans, meta.anchors);
    // anchors: completion-enabled but not `structure` (that marks verbatim);
    // replaced: the only kind carrying generatedLengths
    const anchoredIndex = mappings.findIndex((m) => m.data.completion && !m.data.structure);
    const firstReplacedIndex = mappings.findIndex((m) => m.generatedLengths !== undefined);
    expect(anchoredIndex).toBeGreaterThanOrEqual(0);
    expect(anchoredIndex).toBeLessThan(firstReplacedIndex);
    const anchored = mappings[anchoredIndex];
    expect(anchored?.data).toMatchObject({ verification: true, completion: true, navigation: true, semantic: true });
    expect(mappings[firstReplacedIndex]?.data).toEqual({ verification: true });
    const s = anchored?.sourceOffsets[0] as number;
    const g = anchored?.generatedOffsets[0] as number;
    const l = anchored?.lengths?.[0] as number;
    expect(src.slice(s, s + l)).toBe("U");
    expect(code.slice(g, g + l)).toBe("U");
  });
});

describe("marker template anchors", () => {
  it("the copied marker bytes have completion-enabled mappings right after `${.`", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${...} in .tsi fixture source
    const src = "infer function go`CTX ${.signature} ${.next}`(m: string) {\n  return m;\n}\n";
    const { code, meta } = compileNola(src, "x.tsi");
    const mapper = defaultMapperFactory(spansToMappings(meta.spans, meta.anchors, code));
    const cursor = src.indexOf("${.signature") + "${.".length; // right after the dot
    const completable = [...mapper.toGeneratedLocation(cursor)].filter(([, m]) => m.data.completion);
    expect(completable).not.toEqual([]);
    const [gen] = completable[0] as [number, unknown];
    expect(code.slice(gen - "__nola_s.".length, gen)).toBe("__nola_s.");
  });
});
