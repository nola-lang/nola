import { stripTypeScriptTypes } from "node:module";
import remappingImport from "@ampproject/remapping";
import { decode, encode } from "@jridgewell/sourcemap-codec";
import type { Diagnostic } from "@nola-lang/ast";
import {
  type CompileOptions,
  type CompileResult,
  compileNola,
  type DerivationAnswer,
  finalizeDerivations,
} from "@nola-lang/compiler";

// `@ampproject/remapping` ships an array-fallback `exports` map that TS resolves as a
// CJS namespace, though the runtime (.mjs) default is the callable itself.
type SourceMapish = { toString(): string; sources: string[] };
type Remapping = (input: unknown, loader: (sourcefile: string) => unknown, options?: boolean) => SourceMapish;
const remapping = remappingImport as unknown as Remapping;

export function formatDiagnostics(diagnostics: Diagnostic[]): string {
  return diagnostics
    .map((d) => `${d.file}:${d.loc.start.line}:${d.loc.start.column + 1} ${d.code}: ${d.message}`)
    .join("\n");
}

export class NolaTransformError extends Error {
  override name = "NolaTransformError";
  constructor(readonly diagnostics: Diagnostic[]) {
    super(formatDiagnostics(diagnostics));
  }
}

/**
 * Debugger-facing map hygiene, applied to esbuild's map BEFORE the merge.
 *
 * The loader's merged map is what js-debug steps by, and stepping should walk
 * STRAIGHT THROUGH intent construction: F11 on `ask fn(...)` must land in the
 * callee's body, not tour the lowered wrapper. js-debug's smart-stepping does
 * exactly that for UNMAPPED positions, so here the wrapper lines (generated
 * lines that begin inside replaced text — the infer opener/closer; identified
 * via meta.spans in LOWERED space, where they are still distinguishable) lose
 * their segments. Two segment classes must go:
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
function wrapperLinesOf(lowered: CompileResult): Set<number> {
  const generated = lowered.code;
  const lineStarts = [0];
  for (let i = 0; i < generated.length; i++) if (generated[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (offset: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const wrapperLines = new Set<number>();
  for (const sp of lowered.meta.spans) {
    if (sp.kind !== "replaced") continue;
    let line = lineOf(sp.generatedStart);
    if (lineStarts[line] < sp.generatedStart) line += 1;
    for (; line < lineStarts.length && lineStarts[line] < sp.generatedEnd; line++) wrapperLines.add(line);
  }
  return wrapperLines;
}

/**
 * The debug map when stripping preserved the layout: the compiler map itself,
 * minus every segment on a wrapper line (the compiler's `anchorInsertedLines`
 * anchors, kept for `nola build` dist maps and `nola check`, deliberately
 * absent here — see stripWrapperSegments). `sources` is the on-disk .tsi in
 * forward-slash form, which is what js-debug's breakpoint matching needs.
 */
function layoutMap(lowered: CompileResult): string {
  const map = JSON.parse(lowered.map.toString()) as { mappings: string; sources: string[] };
  const decoded = decode(map.mappings);
  for (const line of wrapperLinesOf(lowered)) if (line < decoded.length) decoded[line] = [];
  map.mappings = encode(decoded);
  map.sources = map.sources.map((src) => src.replace(/\\/g, "/"));
  return JSON.stringify(map);
}

function stripWrapperSegments(jsMap: string, lowered: CompileResult): string {
  const map = JSON.parse(jsMap) as { mappings: string };
  const decoded = decode(map.mappings);
  const wrapperLines = wrapperLinesOf(lowered);
  let prevLast: number[] | undefined;
  for (let l = 0; l < decoded.length; l++) {
    const original = decoded[l];
    let segments = original.filter((s) => s.length >= 4 && !wrapperLines.has(s[2] as number));
    const first = segments[0];
    if (first && first[0] === 0 && prevLast && first[2] === prevLast[2] && first[3] === prevLast[3]) {
      segments = segments.slice(1);
    }
    if (original.length > 0) prevLast = original[original.length - 1] as number[];
    decoded[l] = segments;
  }
  map.mappings = encode(decoded);
  return JSON.stringify(map);
}

/**
 * Type stripping is Node's own (`stripTypeScriptTypes`, the same amaro/swc
 * pass that runs plain `.ts`), not esbuild's — for the debugger. Strip mode
 * replaces types with whitespace, so the generated text keeps the lowered
 * text's line/column layout exactly. That matters because js-debug binds a
 * `.tsi` breakpoint twice: through the inline map AND raw by URL + line on
 * the compiled script, whose URL IS the .tsi path. esbuild collapsed removed
 * declarations (a 6-line interface shifted everything up), so the raw copy
 * landed in the appendix — inside `__nola_file_ctx`, which every ask calls —
 * and F10 over a top-level ask stopped there, in unmapped code, and degraded
 * into a continue. With the layout preserved the two bindings coincide.
 *
 * Erasable syntax only, like Node's own `.ts` rule; a file that needs more
 * (an enum, a namespace, parameter properties) falls back to transform mode,
 * which carries a map and is merged like esbuild's used to be. Synchronous
 * and in-process — no esbuild service to mind inside the hooks worker.
 */
export function stripTypes(code: string, file: string): { code: string; map?: string } {
  try {
    return { code: quietly(() => stripTypeScriptTypes(code, { mode: "strip" })) };
  } catch (error) {
    if ((error as { code?: string }).code !== "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX") throw error;
  }
  const out = quietly(() => stripTypeScriptTypes(code, { mode: "transform", sourceMap: true, sourceUrl: file }));
  const m = /\n\/\/# sourceMappingURL=data:application\/json[^,]*,([A-Za-z0-9+/=]+)\s*$/.exec(out);
  if (!m) return { code: out };
  return { code: out.slice(0, m.index), map: Buffer.from(m[1] as string, "base64").toString("utf8") };
}

/**
 * The API is stability 1.1; Node emits one ExperimentalWarning per process the
 * first time it is called. The loader calls it on purpose, on every run, so
 * that line is ours to own — swallow exactly that warning, nothing else.
 */
let warned = false;
function quietly<T>(fn: () => T): T {
  if (warned) return fn();
  warned = true;
  const original = process.emitWarning;
  process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
    if (String(warning).includes("stripTypeScriptTypes")) return;
    return (original as (...args: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return fn();
  } finally {
    process.emitWarning = original;
  }
}

/** Phase 2 seam: answer a phase-1 result's derivation requests (the DerivationService, or tshost's checker). */
export type DeriveStep = (file: string, phase1: CompileResult) => DerivationAnswer[];

/** Turbopack seam: rewrite the FINALIZED appendix (inline views) before stripping; the appendix is unmapped, so the map survives. */
export type InlineViewsStep = (lowered: CompileResult) => CompileResult;

export async function transformNola(
  source: string,
  file: string,
  options: CompileOptions & { derive?: DeriveStep; inlineViews?: InlineViewsStep } = {},
): Promise<{ code: string; map: string; deps: string[] }> {
  const { derive, inlineViews, ...compileOptions } = options;
  const phase1 = compileNola(source, file, compileOptions);
  if (phase1.diagnostics.length > 0) throw new NolaTransformError(phase1.diagnostics);
  const answers = derive ? derive(file, phase1) : [];
  let lowered = derive ? finalizeDerivations(phase1, answers, file) : phase1;
  if (lowered.diagnostics.length > 0) throw new NolaTransformError(lowered.diagnostics);
  if (inlineViews) lowered = inlineViews(lowered);
  const deps = [...new Set(answers.flatMap((a) => a.deps))];
  const js = stripTypes(lowered.code, file);
  if (js.map === undefined) return { code: js.code, map: layoutMap(lowered), deps };
  // Transform mode (non-erasable syntax): the stripper's map chains onto the
  // compiler map. One-shot loader: its single source resolves to the compiler
  // map; the compiler map's own source (same file name) is the original leaf → null.
  const stripped = stripWrapperSegments(js.map, lowered);
  let consumed = false;
  const merged = remapping(stripped, () => {
    if (consumed) return null;
    consumed = true;
    return lowered.map;
  });
  return { code: js.code, map: merged.toString(), deps };
}
