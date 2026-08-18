import remappingImport from "@ampproject/remapping";
import { decode, encode } from "@jridgewell/sourcemap-codec";
import type { Diagnostic } from "@nola-lang/ast";
import { type CompileOptions, type CompileResult, compileNola } from "@nola-lang/compiler";
import { transform } from "esbuild";

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
function stripWrapperSegments(jsMap: string, lowered: CompileResult): string {
  const map = JSON.parse(jsMap) as { mappings: string };
  const decoded = decode(map.mappings);
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

// Async `transform` (esbuild's child-process service), NOT `transformSync`. The loader
// runs inside Node's module-hooks worker thread, and `transformSync` there spawns a
// nested worker_threads Worker (startWorkerThreadService) that the VS Code debugger's
// worker instrumentation intermittently breaks ("Worker is not a constructor"). The
// async API uses a child process instead, so it is safe under a debugger. Keep it async.
export async function transformNola(
  source: string,
  file: string,
  options: CompileOptions = {},
): Promise<{ code: string; map: string }> {
  const lowered = compileNola(source, file, options);
  if (lowered.diagnostics.length > 0) throw new NolaTransformError(lowered.diagnostics);
  const js = await transform(lowered.code, { loader: "ts", format: "esm", sourcemap: "external", sourcefile: file });
  const stripped = stripWrapperSegments(js.map, lowered);
  // One-shot loader: the esbuild map's single source resolves to the compiler map;
  // the compiler map's own source (same file name) is the original leaf → null.
  let consumed = false;
  const merged = remapping(stripped, () => {
    if (consumed) return null;
    consumed = true;
    return lowered.map;
  });
  return { code: js.code, map: merged.toString() };
}
