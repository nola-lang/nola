import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  type CompileResult,
  displayPathFor,
  moduleIdFor,
  posixDirname,
  posixRelative,
  viewSourceCandidates,
} from "@nola-lang/compiler";
import type { DerivationService } from "@nola-lang/derive";

const VIEW_IMPORT = /^import \{ (\S+) as (\S+) \} from "(\.\.?\/[^"]+\.tsi)";\n/gm;

/**
 * Turbopack has no virtual-module layer, so the `.tsi` value imports a
 * finalized module carries (`import { X as __nola_type_X } from "./models.tsi"`)
 * must be INLINED when `./models.tsi` is the view of a plain module: the
 * view's finalized accessor block is appended under a per-module prefix
 * (`__nola_view_<slug>_`) and the import becomes a delegating accessor. A
 * real `.tsi` keeps its import (Turbopack serves it); a miss keeps it too so
 * Turbopack reports it. Views reached from views inline recursively; a real
 * `.tsi` reached that way is re-relativized to the importing file.
 * The appendix is unmapped, so rewriting it leaves the source map intact.
 */
export function inlineViews(
  lowered: CompileResult,
  file: string,
  sourceRoot: string,
  service: DerivationService,
): CompileResult {
  const { appendixStart } = lowered.meta;
  if (appendixStart < 0) return lowered;
  const inlined = new Map<string, string>(); // moduleId -> prefix
  const blocks: string[] = []; // inlined view accessor blocks, post-order (function declarations hoist)
  const kept = new Set<string>();

  // a fresh regex per call: `process` recurses from inside the replacer, and a
  // shared global regex would have its lastIndex reset under the outer replace
  const process = (block: string, importerFile: string): string =>
    block.replace(new RegExp(VIEW_IMPORT.source, "gm"), (line, imported: string, local: string, spec: string) => {
      const target = resolve(dirname(importerFile), spec);
      if (existsSync(target)) {
        // a real Nola file: keep the import, re-relativized to the file Turbopack is loading
        const rel = posixRelative(posixDirname(file.replace(/\\/g, "/")), target.replace(/\\/g, "/"));
        const relSpec = rel.startsWith(".") ? rel : `./${rel}`;
        kept.add(relSpec);
        return `import { ${imported} as ${local} } from ${JSON.stringify(relSpec)};\n`;
      }
      const src = viewSourceCandidates(target).find((c) => existsSync(c));
      if (!src) {
        kept.add(spec);
        return line; // a miss: Turbopack reports it
      }
      const moduleId = moduleIdFor(displayPathFor(importerFile, sourceRoot), spec);
      let prefix = inlined.get(moduleId);
      if (!prefix) {
        prefix = `__nola_view_${moduleId.replace(/[^A-Za-z0-9_$]/g, "_")}_`;
        inlined.set(moduleId, prefix); // reserve BEFORE deriving: a cyclic view must find itself
        const view = service.deriveView(src);
        if (view.code !== "" && view.appendixStart >= 0) {
          const renamed = view.code.slice(view.appendixStart).replace(/\b__nola_type_(?=[\w$])/g, prefix);
          // `blocks.push(process(...))`, never `extra += process(...)`: the nested
          // call pushes its own blocks while running, and a read-modify-write on a
          // string would drop them
          blocks.push(process(renamed, src));
        }
      }
      return `function ${local}(): import("@nola-lang/runtime").InferType<unknown> { return ${prefix}${imported}(); }\n`;
    });

  const appendix = process(lowered.code.slice(appendixStart), file);
  const code = lowered.code.slice(0, appendixStart) + appendix + blocks.join("");
  const spans = lowered.meta.spans.map((s) => ({ ...s }));
  const last = spans[spans.length - 1];
  if (last?.kind === "appendix") last.generatedEnd = code.length;
  return { ...lowered, code, meta: { ...lowered.meta, spans, views: [...kept].sort() } };
}
