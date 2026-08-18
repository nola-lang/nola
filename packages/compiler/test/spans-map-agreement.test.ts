import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";

/** offset → { line: 1-based, column: 0-based } (Babel/source-map convention) */
function lineCol(text: string, offset: number): { line: number; column: number } {
  const upTo = text.slice(0, offset);
  const lastNl = upTo.lastIndexOf("\n");
  return { line: upTo.split("\n").length, column: offset - (lastNl + 1) };
}

const FIXTURES = [
  "const i = ..`get a name`<string>;\n",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${...} in .tsi fixture source
  "infer function go(input: string) {\n  return ask ..`extract ${input} now`<string>;\n}\n",
  "infer function go`do the thing`(input: string) {\n  return ask ..`p`;\n}\n",
];

describe("meta.spans agree with the v3 source map", () => {
  for (const source of FIXTURES) {
    it(`verbatim span starts trace back to their source position: ${JSON.stringify(source.slice(0, 20))}`, () => {
      const r = compileNola(source, "t.tsi");
      expect(r.diagnostics).toEqual([]);
      const tracer = new TraceMap(r.map as never);
      for (const sp of r.meta.spans) {
        if (sp.kind !== "verbatim" || sp.generatedEnd === sp.generatedStart) continue;
        // check the first and the middle character of every verbatim span —
        // except line terminators: magic-string's hires map emits a segment
        // for every character EXCEPT `\n`, so tracing a newline falls back to
        // the previous segment (or null). Newlines carry no mappable content.
        for (const genOffset of [sp.generatedStart, Math.floor((sp.generatedStart + sp.generatedEnd) / 2)]) {
          if (r.code[genOffset] === "\n" || r.code[genOffset] === "\r") continue;
          const gen = lineCol(r.code, genOffset);
          const orig = originalPositionFor(tracer, gen);
          const expected = lineCol(source, sp.sourceStart + (genOffset - sp.generatedStart));
          expect({ line: orig.line, column: orig.column }).toEqual(expected);
        }
      }
    });
  }
});
