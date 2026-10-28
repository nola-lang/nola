import remappingImport from "@ampproject/remapping";
import { type CompileResult, layoutMap, stripWrapperSegments } from "@nola-lang/compiler";
import type ts from "typescript";
import { type Blanker, createBlanker } from "./vendor/ts-blank-space/index.js";

export type TypeScriptModule = typeof ts;

// `@ampproject/remapping` ships an array-fallback `exports` map that TS resolves as a
// CJS namespace, though the runtime (.mjs) default is the callable itself (node-loader's pattern).
type SourceMapish = { toString(): string };
type Remapping = (input: unknown, loader: (sourcefile: string) => unknown) => SourceMapish;
const remapping = remappingImport as unknown as Remapping;

export interface StripOptions {
  /** The one name the map gives the source and the program carries as `//# sourceURL` — what DevTools shows at a pause. */
  sourceUrl: string;
}

export interface Stripped {
  /** runnable JavaScript (ESM); in layout mode every body line sits where the lowered text had it */
  code: string;
  /** the debug map (JSON): `sources` is `[sourceUrl]`, the source text embedded */
  map: string;
  /** `layout`: types blanked to whitespace; `transform`: non-erasable syntax met, TypeScript transpiled with a merged map */
  mode: "layout" | "transform";
}

// One blanker per TypeScript module (its scanner and state are per module); hosts hand in the same module every time.
const blankers = new WeakMap<TypeScriptModule, Blanker>();
function blankerFor(t: TypeScriptModule): Blanker {
  let blanker = blankers.get(t);
  if (!blanker) {
    blanker = createBlanker(t);
    blankers.set(t, blanker);
  }
  return blanker;
}

/** `sources` renamed to the host's one name; `sourcesContent` (the compiler embeds it) rides along untouched. */
function named(mapJson: string, sourceUrl: string): string {
  const map = JSON.parse(mapJson) as { sources?: string[]; file?: string };
  map.sources = [sourceUrl];
  map.file = undefined;
  return JSON.stringify(map);
}

/**
 * The loader's `stripTypes` + debug map for a browser host (packages/node-loader/src/transform.ts
 * is the Node twin). Erasable syntax is blanked to whitespace — ts-blank-space, vendored, over the
 * HOST'S TypeScript — so the JavaScript keeps the lowered text's line/column layout exactly and
 * the map is the compiler's minus the wrapper lines (`layoutMap`): a breakpoint on a `.tsi` line
 * binds raw and mapped alike, the layout invariant the Node loader relies on. A file with
 * non-erasable syntax (an enum, a namespace, parameter properties) is transpiled by the same
 * TypeScript instead, its map stripped of wrapper segments and merged onto the compiler's, as the
 * loader's transform mode does.
 */
export function stripLowered(t: TypeScriptModule, lowered: CompileResult, options: StripOptions): Stripped {
  let unsupported = false;
  const blanked = blankerFor(t).tsBlankSpace(lowered.code, () => {
    unsupported = true;
  });
  if (!unsupported) return { code: blanked, map: layoutMap(lowered, options.sourceUrl), mode: "layout" };

  const out = t.transpileModule(lowered.code, {
    fileName: options.sourceUrl,
    compilerOptions: {
      target: t.ScriptTarget.ESNext,
      module: t.ModuleKind.ESNext,
      sourceMap: true,
      verbatimModuleSyntax: true,
    },
  });
  const code = out.outputText.replace(/\n?\/\/# sourceMappingURL=[^\n]*\n?$/, "\n");
  // Transform mode (non-erasable syntax): the stripper's map chains onto the compiler map. One-shot
  // loader: its single source resolves to the compiler map; the compiler map's own source (the
  // original leaf) → null.
  const stripped = stripWrapperSegments(out.sourceMapText ?? '{"version":3,"sources":[],"mappings":""}', lowered);
  let consumed = false;
  const merged = remapping(stripped, () => {
    if (consumed) return null;
    consumed = true;
    return lowered.map.toString();
  });
  return { code, map: named(merged.toString(), options.sourceUrl), mode: "transform" };
}
