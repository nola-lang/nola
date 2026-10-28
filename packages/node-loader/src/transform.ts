import { stripTypeScriptTypes } from "node:module";
import remappingImport from "@ampproject/remapping";
import type { Diagnostic } from "@nola-lang/ast";
import {
  type CompileOptions,
  type CompileResult,
  compileNola,
  type DerivationAnswer,
  finalizeDerivations,
  layoutMap,
  stripWrapperSegments,
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

// The debug map (wrapper lines unmapped, esbuild-style carry segments dropped) is the
// compiler's `layoutMap` / `stripWrapperSegments` (packages/compiler/src/debug-map.ts,
// moved there 2026-10-06 so a browser host shares it with this loader byte for byte).

/**
 * Type stripping is Node's own (`stripTypeScriptTypes`, the same amaro/swc
 * pass that runs plain `.ts`), not esbuild's — for the debugger. Strip mode
 * replaces types with whitespace, so the generated text keeps the lowered
 * text's line/column layout exactly. That matters because js-debug binds a
 * `.tsi` breakpoint twice: through the inline map AND raw by URL + line on
 * the compiled script, whose URL IS the .tsi path. esbuild collapsed removed
 * declarations (a 6-line interface shifted everything up), so the raw copy
 * landed in the appendix — inside the module accessor (`__nola_module_ctx`, then `__nola_file_ctx`), which every ask calls —
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

type TransformOptions = CompileOptions & { derive?: DeriveStep; inlineViews?: InlineViewsStep }

export async function transformNola(
  source: string, file: string, options: TransformOptions = {}
): Promise<{ code: string; map: string; deps: string[] }> {
  const { derive, inlineViews, ...compileOptions } = options;

  const phase1 = compileNola(source, file, compileOptions);
  if (phase1.diagnostics.length > 0)
    throw new NolaTransformError(phase1.diagnostics);

  const answers = derive ? derive(file, phase1) : [];

  let lowered = derive ? finalizeDerivations(phase1, answers, file) : phase1;
  if (lowered.diagnostics.length > 0)
    throw new NolaTransformError(lowered.diagnostics);

  if (inlineViews)
    lowered = inlineViews(lowered);

  const deps = [...new Set(answers.flatMap((a) => a.deps))];
  const js = stripTypes(lowered.code, file);
  if (js.map === undefined)
    return { code: js.code, map: layoutMap(lowered), deps };
  
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
