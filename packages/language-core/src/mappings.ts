import type { Anchor, Span } from "@nola-lang/compiler";
import type { CodeMapping } from "@volar/language-core";

const VERBATIM_DATA = {
  verification: true,
  completion: true,
  semantic: true,
  navigation: true,
  structure: true,
  // format stays false on the GENERATED side: the lowering nests infer-function
  // bodies one level deeper than the source (the Intent executor closure), so
  // TS-formatter indentation computed on the lowered text maps back wrong
  // (double-indented bodies). Formatting is instead served on the SOURCE text
  // by the language server's nola service plugin, admitted through the root
  // code's format-only identity mapping (NolaVirtualCode.mappings).
  format: false,
} as const;

const REPLACED_DATA = { verification: true } as const;

// Verification included: quick fixes (Volar's isCodeActionsEnabled) ride the
// verification flag, and a TS error INSIDE the anchor must report at the
// precise source range (Ctrl+. needs the diagnostic in its request context).
// No double-reporting: range translation is first-match in mapping order, and
// the anchored mapping precedes the replaced one below — anchors win exactly
// for the ranges they cover, replaced keeps everything else (collapsed).
const ANCHOR_DATA = {
  verification: true,
  completion: true,
  semantic: true,
  navigation: true,
  format: false,
} as const;

// Insertion points: the appendix import group attracts TypeScript's
// missing-import quick fix (its inserter targets the file's existing import
// statements, and a source with no imports of its own has ONLY the appendix
// ones). Zero-length generated ranges at import-statement boundaries map pure
// INSERTS to source [0, 0] — the top of the .tsi, where an added import
// belongs. Replacements never translate through them (a non-zero range's end
// misses the zero-length segment), so appendix rewrites can't leak into the
// source. isRenameEnabled (the edit-translation gate) needs `navigation`.
const INSERTION_DATA = { navigation: true, format: false } as const;

/**
 * meta.spans -> Volar mappings. Verbatim spans carry every feature; replaced
 * spans are diagnostics-only (a TS error inside emitted text lands collapsed
 * at the construct); anchors give full features (precise diagnostics, quick
 * fixes, navigation, hover, completion) to source fragments copied verbatim
 * INTO replaced output (an extractor's `<T>`); the appendix is unmapped except
 * for zero-length import-insertion points (quick-fix inserts land at the top
 * of the source). Pass the generated `code` so those points can be located.
 *
 * ONE MAPPING PER SPAN — never pack spans into shared parallel arrays. Volar
 * translates a range by matching its START against every mapping, then calling
 * translateOffset for the END against THAT mapping's whole offset array. A
 * lowering that deletes source text (a tagged header's instruction, `infer `,
 * `..`) makes one generated offset mean two source offsets — the end of the
 * span before the deletion and the start of the span after it. With shared
 * arrays, translateOffset's binary search can return the later one, stretching
 * the range across the deleted text (a `function` semantic token that paints
 * the whole instruction). A single-segment mapping confines the end to the
 * span whose start matched; genuinely multi-span ranges still resolve through
 * Volar's fallbackToAnyMatch path.
 */
export function spansToMappings(spans: Span[], anchors: Anchor[] = [], code?: string): CodeMapping[] {
  const verbatim: CodeMapping[] = [];
  const replaced: CodeMapping[] = [];
  const afterBroken = new Set(spans.filter((s) => s.kind === "broken").map((s) => s.sourceEnd));
  for (const span of spans) {
    if (span.kind === "verbatim") {
      // A position is matched by a mapping whose range merely ENDS there, so a
      // broken construct cannot hide the cursor sitting right after it — this
      // span, which starts at that same offset, would answer instead. That is
      // the half-typed `..` marker: the user has typed one dot, and TypeScript
      // (whose `.` trigger is always valid) offers the entire global scope.
      // Split the boundary character off into a completion-free mapping; it
      // keeps every other feature, so only the suggestion widget is affected.
      if (afterBroken.has(span.sourceStart) && span.sourceEnd > span.sourceStart) {
        verbatim.push({
          sourceOffsets: [span.sourceStart],
          generatedOffsets: [span.generatedStart],
          lengths: [1],
          data: { ...VERBATIM_DATA, completion: false },
        });
        if (span.sourceEnd - span.sourceStart === 1) continue;
        verbatim.push({
          sourceOffsets: [span.sourceStart + 1],
          generatedOffsets: [span.generatedStart + 1],
          lengths: [span.sourceEnd - span.sourceStart - 1],
          data: { ...VERBATIM_DATA },
        });
        continue;
      }
      verbatim.push({
        sourceOffsets: [span.sourceStart],
        generatedOffsets: [span.generatedStart],
        lengths: [span.sourceEnd - span.sourceStart],
        data: { ...VERBATIM_DATA },
      });
    } else if (span.kind === "replaced" || span.kind === "broken") {
      replaced.push({
        sourceOffsets: [span.sourceStart],
        generatedOffsets: [span.generatedStart],
        lengths: [span.sourceEnd - span.sourceStart],
        generatedLengths: [span.generatedEnd - span.generatedStart],
        data: { ...REPLACED_DATA },
      });
    }
    // appendix: unmapped by design
  }
  const anchored: CodeMapping[] = anchors.map((anchor) => ({
    sourceOffsets: [anchor.sourceStart],
    generatedOffsets: [anchor.generatedStart],
    lengths: [anchor.sourceEnd - anchor.sourceStart],
    data: { ...ANCHOR_DATA },
  }));
  const insertion: CodeMapping = { sourceOffsets: [], generatedOffsets: [], lengths: [], data: { ...INSERTION_DATA } };
  const appendix = spans.find((s) => s.kind === "appendix");
  if (appendix && code) {
    const text = code.slice(appendix.generatedStart, appendix.generatedEnd);
    for (const match of text.matchAll(/^import .*$/gm)) {
      const lineStart = appendix.generatedStart + (match.index as number);
      for (const offset of [lineStart, lineStart + (match[0] as string).length + 1]) {
        insertion.sourceOffsets.push(0);
        insertion.generatedOffsets.push(offset);
        insertion.lengths.push(0);
      }
    }
  }
  // Group order is load-bearing (translation is first-match in this order), so
  // it is kept exactly as before the per-span split: verbatim, then anchors
  // BEFORE replaced — the precise anchor must beat the replaced span's clamped
  // translation inside anchor ranges — then the insertion points LAST, since
  // source offset 0 is shared with the first verbatim mapping, which must win
  // every source-side query there (insertions only matter generated->source).
  return [...verbatim, ...anchored, ...replaced, ...(insertion.generatedOffsets.length > 0 ? [insertion] : [])];
}
