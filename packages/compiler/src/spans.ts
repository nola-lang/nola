import { decode, encode } from "@jridgewell/sourcemap-codec";
import type { SourceMap } from "magic-string";
import MagicString from "magic-string";

/**
 * `broken` is a replacement standing in for a construct the parser could only
 * recover as a placeholder (a `..` whose prompt is still being typed). It maps
 * like `replaced`, but the editor layer additionally opts the character AFTER
 * it out of completion — see spansToMappings.
 */
export type SpanKind = "verbatim" | "replaced" | "broken" | "appendix";

export interface Span {
  sourceStart: number;
  sourceEnd: number;
  generatedStart: number;
  generatedEnd: number;
  kind: SpanKind;
}

/**
 * A source fragment copied byte-identically into replacement text (e.g. the
 * extractor's `<T>` type text re-emitted inside `ExtractIntent<T>`). Anchors
 * ride on top of the span tiling: the source range also belongs to a replaced
 * span (which keeps diagnostics), while the anchor gives the fragment
 * full-feature editor mappings (navigation, hover, completion).
 */
export interface Anchor {
  sourceStart: number;
  sourceEnd: number;
  generatedStart: number;
  generatedEnd: number;
}

/** A copied fragment declared at edit time: where its bytes came from, and where they sit in `text`. */
export interface EditAnchor {
  sourceStart: number;
  sourceEnd: number;
  /** offset of the copied bytes within the edit's replacement text */
  textOffset: number;
}

interface Edit {
  sourceStart: number;
  sourceEnd: number;
  text: string;
  /** 0 = left-side insert/overwrite, 1 = right-side insert (see finalize). */
  side: 0 | 1;
  seq: number;
  anchors?: EditAnchor[];
  /** replacement for a placeholder the parser could not complete */
  broken?: boolean;
}

/**
 * Records every MagicString mutation lower() performs so finalize() can
 * reconstruct the generated file as a tiling of spans. meta.spans is the
 * ground truth for editor mappings (spec §4c); the v3 source map stays as
 * derived output for the loader and `nola check`.
 *
 * Only the mutations lower() actually uses are exposed. The correctness
 * anchor is the byte-equality invariant test, not this class: if MagicString
 * ordering ever disagrees with finalize()'s model, spans.test.ts fails.
 */
/**
 * Debugger hygiene for the v3 map: every generated line that BEGINS inside
 * replaced/inserted text gets a line-start segment anchored at the edit's
 * source position. magic-string emits no mappings for inserted text, which
 * leaves whole wrapper lines (the infer-function opener and closer) unmapped;
 * the loader's esbuild merge then attributes such a line to the previous
 * mapped token via esbuild's line-start carry segment — observed as F11 into
 * an infer function displaying the body's LAST line while actually paused in
 * intent construction. With the anchor, the opener pauses display the
 * function header and the closer (including the arrow's return position)
 * displays the close-brace line. The appendix keeps its unmapped contract.
 */
export function anchorInsertedLines(map: SourceMap, spans: Span[], generated: string, source: string): void {
  const lineStartsOf = (text: string): number[] => {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
    return starts;
  };
  const lineOf = (starts: number[], offset: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const genStarts = lineStartsOf(generated);
  const srcStarts = lineStartsOf(source);
  const decoded = decode(map.mappings);
  let changed = false;
  for (const sp of spans) {
    if (sp.kind !== "replaced") continue;
    const srcLine = lineOf(srcStarts, sp.sourceStart);
    const srcCol = sp.sourceStart - srcStarts[srcLine];
    let line = lineOf(genStarts, sp.generatedStart);
    if (genStarts[line] < sp.generatedStart) line += 1;
    for (; line < genStarts.length && genStarts[line] < sp.generatedEnd; line++) {
      while (decoded.length <= line) decoded.push([]);
      const segs = decoded[line];
      if (segs.length === 0 || segs[0][0] > 0) {
        segs.unshift([0, 0, srcLine, srcCol]);
        changed = true;
      }
    }
  }
  if (changed) map.mappings = encode(decoded);
}

export class SpanRecorder {
  private readonly s: MagicString;
  private readonly edits: Edit[] = [];
  private appendixText = "";
  private seq = 0;

  constructor(source: string) {
    this.s = new MagicString(source);
  }

  overwrite(start: number, end: number, text: string, options: { anchors?: EditAnchor[]; broken?: boolean } = {}): void {
    this.s.overwrite(start, end, text);
    this.edits.push({ sourceStart: start, sourceEnd: end, text, side: 0, seq: this.seq++, ...options });
  }

  remove(start: number, end: number): void {
    this.s.remove(start, end);
    this.edits.push({ sourceStart: start, sourceEnd: end, text: "", side: 0, seq: this.seq++ });
  }

  appendLeft(pos: number, text: string, options: { anchors?: EditAnchor[] } = {}): void {
    this.s.appendLeft(pos, text);
    this.edits.push({ sourceStart: pos, sourceEnd: pos, text, side: 0, seq: this.seq++, ...options });
  }

  appendRight(pos: number, text: string): void {
    this.s.appendRight(pos, text);
    this.edits.push({ sourceStart: pos, sourceEnd: pos, text, side: 1, seq: this.seq++ });
  }

  /** The EOF insert (runtime import + accessors). Always the last content. */
  appendix(text: string): void {
    this.s.append(text);
    this.appendixText += text;
  }

  toString(): string {
    return this.s.toString();
  }

  generateMap(options: Parameters<MagicString["generateMap"]>[0]): SourceMap {
    return this.s.generateMap(options);
  }

  finalize(sourceLength: number): { spans: Span[]; anchors: Anchor[] } {
    // MagicString emission order at a shared position: appendLeft content
    // precedes appendRight content; same-side calls emit in call order.
    // Sorting by (sourceStart, side, seq) reproduces that order.
    const edits = [...this.edits].sort((a, b) => a.sourceStart - b.sourceStart || a.side - b.side || a.seq - b.seq);
    const spans: Span[] = [];
    const anchors: Anchor[] = [];
    let src = 0;
    let gen = 0;
    const pushVerbatim = (to: number): void => {
      if (to > src) {
        spans.push({
          sourceStart: src,
          sourceEnd: to,
          generatedStart: gen,
          generatedEnd: gen + (to - src),
          kind: "verbatim",
        });
        gen += to - src;
        src = to;
      }
    };
    for (const e of edits) {
      pushVerbatim(e.sourceStart);
      for (const a of e.anchors ?? []) {
        anchors.push({
          sourceStart: a.sourceStart,
          sourceEnd: a.sourceEnd,
          generatedStart: gen + a.textOffset,
          generatedEnd: gen + a.textOffset + (a.sourceEnd - a.sourceStart),
        });
      }
      const prev = spans[spans.length - 1];
      // A broken construct never merges into the replacement in front of it
      // (`ask ` + the placeholder): the editor layer needs its boundary.
      if (!e.broken && prev && prev.kind === "replaced" && prev.sourceEnd === e.sourceStart && prev.generatedEnd === gen) {
        // Coalesce adjacent replacements (e.g. an extract suffix appendLeft
        // and the enclosing ask's appendRight at the same position).
        prev.sourceEnd = e.sourceEnd;
        prev.generatedEnd += e.text.length;
      } else {
        spans.push({
          sourceStart: e.sourceStart,
          sourceEnd: e.sourceEnd,
          generatedStart: gen,
          generatedEnd: gen + e.text.length,
          kind: e.broken ? "broken" : "replaced",
        });
      }
      gen += e.text.length;
      src = Math.max(src, e.sourceEnd);
    }
    pushVerbatim(sourceLength);
    if (this.appendixText.length > 0) {
      spans.push({
        sourceStart: sourceLength,
        sourceEnd: sourceLength,
        generatedStart: gen,
        generatedEnd: gen + this.appendixText.length,
        kind: "appendix",
      });
    }
    return { spans, anchors };
  }
}
