import type ts from "typescript";

const DECL_SUFFIX = ".d.tsi.ts";

/**
 * Hide `X.d.tsi.ts` from the editor whenever a sibling `X.tsi` exists.
 *
 * With `allowArbitraryExtensions`, TypeScript resolves `./X.tsi` to the
 * adjacent declaration FIRST — an on-disk build artifact (or a stale leftover
 * from the old adjacent-declaration emit) would shadow the live virtual .tsi,
 * sending navigation into the declaration instead of the source. Denying its
 * existence makes standard resolution fail, so Volar's extra-extension
 * resolution serves the .tsi in-memory and definitions map back to source.
 * Declarations without a sibling .tsi (e.g. shipped by a built package whose
 * sources are gone) stay visible.
 */
export function decorateHostHideShadowedDeclarations(typescript: typeof ts, host: ts.LanguageServiceHost): void {
  const priorFileExists = host.fileExists?.bind(host);
  const rawFileExists = (f: string): boolean => priorFileExists?.(f) ?? typescript.sys.fileExists(f);

  const shadowed = (f: string): boolean =>
    f.endsWith(DECL_SUFFIX) && rawFileExists(`${f.slice(0, -DECL_SUFFIX.length)}.tsi`);

  host.fileExists = (f) => (shadowed(f) ? false : rawFileExists(f));

  const priorReadFile = host.readFile?.bind(host);
  host.readFile = (f) => (shadowed(f) ? undefined : priorReadFile?.(f));

  const priorGetSnapshot = host.getScriptSnapshot.bind(host);
  host.getScriptSnapshot = (f) => (shadowed(f) ? undefined : priorGetSnapshot(f));
}
