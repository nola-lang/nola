import {
  compileView,
  loweredVirtualNameFor,
  posixDirname,
  posixJoin,
  viewSourceCandidates,
} from "@nola-lang/compiler";
import type ts from "typescript";

interface ViewCacheEntry {
  sourceVersion: string;
  snapshot: ts.IScriptSnapshot;
}

function norm(p: string): string {
  return p.replace(/\\/g, "/");
}

export interface ViewRegistration {
  sourceFile: string;
  sourceRoot?: string;
}

// Process-wide registry of every view any host decoration has resolved,
// keyed by normalized synthetic fileName (plus a lowercase index for Windows
// case-insensitive probes). The ServerHost decoration reads it so tsserver's
// ScriptInfo/watch layer can treat views as real files — see
// decorateServerHostForViews.
const sharedViews = new Map<string, ViewRegistration>();
const sharedViewsLower = new Map<string, ViewRegistration>();

function registerView(viewFileName: string, registration: ViewRegistration): void {
  sharedViews.set(viewFileName, registration);
  sharedViewsLower.set(viewFileName.toLowerCase(), registration);
}

/**
 * Registry lookup for the ServerHost decoration; exact match first, then
 * case-insensitive. This sits under EVERY fileExists / readFile / stat of the
 * tsserver process (lib files, node_modules probes, tens of thousands per
 * project load), so the normalize + lowercase run only once a probe can be a
 * view at all: something is registered, and the name ends in `.tsi.ts`.
 */
export function viewRegistration(fileName: string): ViewRegistration | undefined {
  if (sharedViews.size === 0) return undefined;
  if (fileName.length < 7 || fileName.slice(-7).toLowerCase() !== ".tsi.ts") return undefined;
  const key = norm(fileName);
  return sharedViews.get(key) ?? sharedViewsLower.get(key.toLowerCase());
}

const isRelativeTsi = (specifier: string): boolean =>
  specifier.endsWith(".tsi") && (specifier.startsWith("./") || specifier.startsWith("../"));

/**
 * Views in the editor (spec §4, emit 14): host-level synthetic scripts (never
 * VirtualCode — nobody edits them, no mappings map back). A relative `.tsi`
 * literal the prior chain left unresolved — no such Nola file — resolves to
 * `<x>.tsi.ts`, the view of `x.ts` / `x.d.ts`, derived from the CURRENT host
 * snapshot of the source file and versioned by that file's script version, so
 * unsaved edits propagate and TypeScript owns invalidation.
 *
 * MUST be installed AFTER Volar's decoration (the plugin's `setup` hook):
 * Volar resolves every `.tsi` literal with its OWN resolver and never
 * delegates, so only a wrapper around it can see the misses.
 */
export function decorateHostWithViews(
  typescript: typeof ts,
  host: ts.LanguageServiceHost,
  options: { sourceRoot?: string } = {},
): void {
  /** synthetic view fileName -> its on-disk/source fileName */
  const viewSources = new Map<string, string>();
  const cache = new Map<string, ViewCacheEntry>();

  const sourceFor = (viewFileName: string): string | undefined => viewSources.get(norm(viewFileName));

  const computeSnapshot = (viewFileName: string): ts.IScriptSnapshot | undefined => {
    const source = sourceFor(viewFileName);
    if (!source) return undefined;
    const version = host.getScriptVersion(source);
    const cached = cache.get(viewFileName);
    if (cached && cached.sourceVersion === version) return cached.snapshot;
    const sourceSnap = host.getScriptSnapshot(source);
    if (!sourceSnap) return undefined;
    const text = sourceSnap.getText(0, sourceSnap.getLength());
    const view = compileView(text, source, { sourceRoot: options.sourceRoot });
    const snapshot = typescript.ScriptSnapshot.fromString(view.code);
    cache.set(viewFileName, { sourceVersion: version, snapshot });
    return snapshot;
  };

  const exists = (p: string): boolean => host.fileExists?.(p) ?? typescript.sys.fileExists(p);

  const tryResolveView = (specifier: string, containingFile: string): string | undefined => {
    if (!isRelativeTsi(specifier)) return undefined;
    // Pure posix arithmetic, never path.resolve: a headless `/proj/...` host on
    // Windows would otherwise gain a drive prefix and miss its own files.
    const target = posixJoin(posixDirname(containingFile), specifier);
    for (const candidate of viewSourceCandidates(target)) {
      if (exists(candidate)) {
        const viewFileName = norm(loweredVirtualNameFor(target));
        viewSources.set(viewFileName, norm(candidate));
        registerView(viewFileName, { sourceFile: norm(candidate), sourceRoot: options.sourceRoot });
        return viewFileName;
      }
    }
    return undefined;
  };

  const priorResolve = host.resolveModuleNameLiterals?.bind(host);
  host.resolveModuleNameLiterals = (literals, containingFile, redirected, opts, file, reused) => {
    // ONE base call with the full literal array: tsserver's resolution cache
    // keeps per-call bookkeeping (reusedNames correspond to the literals it
    // did NOT receive) — per-literal delegation corrupts it and crashes the
    // server in stopWatchFailedLookupLocationOfResolution. Views then fill
    // ONLY the slots the prior chain left unresolved.
    const base: readonly ts.ResolvedModuleWithFailedLookupLocations[] = priorResolve
      ? priorResolve(literals, containingFile, redirected, opts, file, reused)
      : literals.map((literal) => ({
          resolvedModule: typescript.resolveModuleName(literal.text, containingFile, opts, {
            fileExists: exists,
            readFile: (f) => host.readFile?.(f) ?? typescript.sys.readFile(f),
          }).resolvedModule,
        }));
    return literals.map((literal, i) => {
      const prior = base[i] as ts.ResolvedModuleWithFailedLookupLocations;
      if (prior.resolvedModule) return prior;
      const view = tryResolveView(literal.text, containingFile);
      if (!view) return prior;
      return {
        resolvedModule: { resolvedFileName: view, extension: typescript.Extension.Ts, isExternalLibraryImport: false },
      };
    });
  };

  const priorFileExists = host.fileExists?.bind(host);
  host.fileExists = (f) => (sourceFor(f) ? computeSnapshot(norm(f)) !== undefined : (priorFileExists?.(f) ?? false));

  const priorGetSnapshot = host.getScriptSnapshot.bind(host);
  host.getScriptSnapshot = (f) => {
    if (!sourceFor(f)) return priorGetSnapshot(f);
    // Under tsserver the prior chain is Project.getScriptSnapshot, whose side
    // effect mints and attaches the view's ScriptInfo (it exists to tsserver's
    // file layer via decorateServerHostForViews). Without a ScriptInfo,
    // tsserver asserts on the view in several places (document-registry
    // cache, project telemetry). The returned snapshot is still ours —
    // derived from the LIVE source snapshot, so unsaved edits propagate; the
    // ScriptInfo's disk-derived text is never user-visible.
    priorGetSnapshot(f);
    return computeSnapshot(norm(f));
  };

  const priorGetVersion = host.getScriptVersion.bind(host);
  host.getScriptVersion = (f) => {
    const source = sourceFor(f);
    return source ? `view-of:${priorGetVersion(source)}` : priorGetVersion(f);
  };

  const priorReadFile = host.readFile?.bind(host);
  host.readFile = (f) => {
    const snapshot = sourceFor(f) ? computeSnapshot(norm(f)) : undefined;
    return snapshot ? snapshot.getText(0, snapshot.getLength()) : priorReadFile?.(f);
  };
}
