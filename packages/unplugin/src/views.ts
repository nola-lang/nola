import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { Codes } from "@nola-lang/ast";
import { isTsiSpecifier, viewSourceCandidates } from "@nola-lang/compiler";
import type { DerivationService } from "@nola-lang/derive";
import { transform } from "esbuild";
import { isWiringId } from "./core.js";

export const VIEW_PREFIX = "\0nola-view:";

/**
 * Loader-parity resolution (node-loader/hooks.ts, spec §2): a real `.tsi` is
 * the bundler's to serve (null), a miss next to the importer is the VIEW of
 * `x.ts` / `x.d.ts`, and nothing at all is NOLA2007.
 */
export function resolveViewId(specifier: string, importerFile: string): string | null {
  if (!isTsiSpecifier(specifier)) return null;
  const target = resolve(dirname(importerFile), specifier);
  if (existsSync(target)) return null;
  const src = viewSourceCandidates(target).find((c) => existsSync(c));
  if (src) return `${VIEW_PREFIX}${src}`;
  throw new Error(
    `${Codes.ViewUnavailable}: "${specifier}" (imported from ${importerFile}) names neither a Nola file nor a TypeScript module`,
  );
}

export async function loadViewCode(
  id: string,
  service: DerivationService,
): Promise<{ code: string; watchFiles: string[] }> {
  const file = id.slice(VIEW_PREFIX.length);
  // An ABSOLUTE re-export target: a `\0`-prefixed importer has no usable
  // directory for the bundler's relative resolution, and webpack's
  // extensionAlias (.js → .ts) is not guaranteed on every adapter.
  // The service derives (emit 15) and finalizes the view in one call.
  const view = service.deriveView(file, { sourceSpecifier: file.replace(/\\/g, "/") });
  if (view.code === "" || view.diagnostics.length > 0) {
    throw new Error(view.diagnostics.map((d) => `${d.file}: ${d.code}: ${d.message}`).join("\n"));
  }
  // Plain TS with no meaningful original positions — strip types, skip the map (loader parity).
  const js = await transform(view.code, { loader: "ts", format: "esm" });
  const deps = view.answers.flatMap((a) => a.deps);
  return { code: js.code, watchFiles: [...new Set([file, ...deps])] };
}

/** Best-effort NOLA3012 parity: the immediate importer is all a bundler shows us. */
export function guardConfigGraphTsi(specifier: string, importerFile: string | undefined): void {
  if (!specifier.endsWith(".tsi") || importerFile === undefined) return;
  if (isWiringId(importerFile) || basename(importerFile) === "nola.config.ts") {
    throw new Error(
      `${Codes.ConfigImportsTsi}: nola.config.ts cannot import ".tsi" modules ("${specifier}" imported from ${importerFile}) — the config must be evaluable before Nola modules load.`,
    );
  }
}
