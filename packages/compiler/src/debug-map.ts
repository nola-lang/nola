import { decode, encode } from "@jridgewell/sourcemap-codec";
import type { CompileResult } from "./types.js";

// The DEBUG map — what a debugger steps by — as opposed to the compiler map
// `compileNola` returns (which `nola build` dist maps and `nola check` keep,
// anchors included). Moved here from @nola-lang/node-loader (2026-10-06) so a
// browser host (@nola-lang/browser) shares it with the loader byte for byte.

/**
 * Debugger-facing map hygiene, applied to esbuild's map BEFORE the merge.
 *
 * The loader's merged map is what js-debug steps by, and stepping should walk
 * STRAIGHT THROUGH intent construction: F11 on `ask fn(...)` must land in the
 * callee's body, not tour the lowered wrapper. js-debug's smart-stepping does
 * exactly that for UNMAPPED positions, so here the wrapper lines lose their
 * segments. A wrapper line is a generated line that begins inside replaced
 * text AND carries no verbatim source text of its own (whitespace aside): the
 * infer opener and closer, identified via meta.spans in LOWERED space, where
 * they are still distinguishable. A context statement lowered in place at
 * column 0 also BEGINS inside replaced text — its opener is an insert at the
 * statement's first byte — but the statement's own text follows on the same
 * line, so that line keeps its segments: a breakpoint on it must bind through
 * the map, and the pause inside the item (an ask rendering it) must display
 * the .tsi, not the generated script (playground report 2026-09-29; the same
 * holds for a multi-line statement's continuation lines, which begin inside
 * the gap re-emitted between a value and the next text). Two segment classes
 * must go:
 *
 * - segments whose lowered position sits on a wrapper line (the compiler's
 *   `anchorInsertedLines` anchors — kept in the compiler map for `nola build`
 *   dist maps and `nola check`, deliberately absent from the debug map);
 * - esbuild's line-start CARRY segments: esbuild opens each output line by
 *   re-emitting the previous token run's position, so a wrapper output line
 *   would otherwise inherit the BODY'S LAST TOKEN and the debugger displays
 *   the body's last line while paused in construction (the F11
 *   `return valid;` bug). A carry is precise to detect: a column-0 segment
 *   whose original position equals the previous line's last segment's.
 */
export function wrapperLinesOf(lowered: CompileResult): Set<number> {
  const generated = lowered.code;
  const lineStarts = [0];
  for (let i = 0; i < generated.length; i++) if (generated[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (offset: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lineStarts[mid] as number) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  // lines carrying verbatim source text (whitespace aside) are never wrapper lines, whatever begins them
  const textLines = new Set<number>();
  for (const sp of lowered.meta.spans) {
    if (sp.kind !== "verbatim") continue;
    for (let line = lineOf(sp.generatedStart); line < lineStarts.length && (lineStarts[line] as number) < sp.generatedEnd; line++) {
      const from = Math.max(sp.generatedStart, lineStarts[line] as number);
      const to = Math.min(sp.generatedEnd, line + 1 < lineStarts.length ? (lineStarts[line + 1] as number) : generated.length);
      if (/\S/.test(generated.slice(from, to))) textLines.add(line);
    }
  }
  const wrapperLines = new Set<number>();
  for (const sp of lowered.meta.spans) {
    if (sp.kind !== "replaced") continue;
    let line = lineOf(sp.generatedStart);
    if ((lineStarts[line] as number) < sp.generatedStart) line += 1;
    for (; line < lineStarts.length && (lineStarts[line] as number) < sp.generatedEnd; line++) {
      if (!textLines.has(line)) wrapperLines.add(line);
    }
  }
  return wrapperLines;
}

/**
 * The debug map when stripping preserved the layout: the compiler map itself,
 * minus every segment on a wrapper line (the compiler's `anchorInsertedLines`
 * anchors, kept for `nola build` dist maps and `nola check`, deliberately
 * absent here — see stripWrapperSegments). `sources` is the on-disk .tsi in
 * forward-slash form, which is what js-debug's breakpoint matching needs — or
 * the one name a browser host asks for (`sourceUrl`), which is what its
 * DevTools shows at a pause.
 */
export function layoutMap(lowered: CompileResult, sourceUrl?: string): string {
  const map = JSON.parse(lowered.map.toString()) as { mappings: string; sources: string[] };
  const decoded = decode(map.mappings);
  for (const line of wrapperLinesOf(lowered)) if (line < decoded.length) decoded[line] = [];
  map.mappings = encode(decoded);
  map.sources = sourceUrl ? [sourceUrl] : map.sources.map((src) => src.replace(/\\/g, "/"));
  return JSON.stringify(map);
}

/** A stripper's map (transform mode) minus the wrapper-line segments and the line-start carries — see wrapperLinesOf. */
export function stripWrapperSegments(jsMap: string, lowered: CompileResult): string {
  const map = JSON.parse(jsMap) as { mappings: string };
  const decoded = decode(map.mappings);
  const wrapperLines = wrapperLinesOf(lowered);
  let prevLast: number[] | undefined;
  for (let l = 0; l < decoded.length; l++) {
    const original = decoded[l] as number[][];
    let segments = original.filter((s) => s.length >= 4 && !wrapperLines.has(s[2] as number));
    const first = segments[0];
    if (first && first[0] === 0 && prevLast && first[2] === prevLast[2] && first[3] === prevLast[3]) {
      segments = segments.slice(1);
    }
    if (original.length > 0) prevLast = original[original.length - 1] as number[];
    decoded[l] = segments as never;
  }
  map.mappings = encode(decoded);
  return JSON.stringify(map);
}
