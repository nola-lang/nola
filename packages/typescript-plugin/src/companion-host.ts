import { dirname, resolve as resolvePath } from "node:path";
import { companionSourceCandidates, compileCompanion, isCompanionSpecifier } from "@nola-lang/compiler";
import type ts from "typescript";

interface CompanionCacheEntry {
  sourceVersion: string;
  snapshot: ts.IScriptSnapshot;
}

function norm(p: string): string {
  return p.replace(/\\/g, "/");
}

export interface CompanionRegistration {
  sourceFile: string;
  sourceRoot?: string;
}

// Process-wide registry of every companion any host decoration has resolved,
// keyed by normalized companion fileName (plus a lowercase index for Windows
// case-insensitive probes). The ServerHost decoration reads it so tsserver's
// ScriptInfo/watch layer can treat companions as real files — see
// decorateServerHostForCompanions.
const sharedCompanions = new Map<string, CompanionRegistration>();
const sharedCompanionsLower = new Map<string, CompanionRegistration>();

function registerCompanion(companionFileName: string, registration: CompanionRegistration): void {
  sharedCompanions.set(companionFileName, registration);
  sharedCompanionsLower.set(companionFileName.toLowerCase(), registration);
}

/** Registry lookup for the ServerHost decoration; exact match first, then case-insensitive. */
export function companionRegistration(fileName: string): CompanionRegistration | undefined {
  const key = norm(fileName);
  return sharedCompanions.get(key) ?? sharedCompanionsLower.get(key.toLowerCase());
}

/**
 * Companions in the editor: host-level synthetic scripts (never VirtualCode —
 * nobody edits them, no mappings map back). Derived from the CURRENT host
 * snapshot of the source file and versioned by that file's script version, so
 * unsaved edits propagate and TypeScript owns invalidation (spec §6b).
 */
export function decorateHostWithCompanions(
  typescript: typeof ts,
  host: ts.LanguageServiceHost,
  options: { sourceRoot?: string } = {},
): void {
  /** synthetic companion fileName -> its on-disk/source fileName */
  const companionSources = new Map<string, string>();
  const cache = new Map<string, CompanionCacheEntry>();

  const sourceFor = (companionFileName: string): string | undefined => companionSources.get(norm(companionFileName));

  const computeSnapshot = (companionFileName: string): ts.IScriptSnapshot | undefined => {
    const source = sourceFor(companionFileName);
    if (!source) return undefined;
    const version = host.getScriptVersion(source);
    const cached = cache.get(companionFileName);
    if (cached && cached.sourceVersion === version) return cached.snapshot;
    const sourceSnap = host.getScriptSnapshot(source);
    if (!sourceSnap) return undefined;
    const text = sourceSnap.getText(0, sourceSnap.getLength());
    const companion = compileCompanion(text, source, { sourceRoot: options.sourceRoot });
    const snapshot = typescript.ScriptSnapshot.fromString(companion.code);
    cache.set(companionFileName, { sourceVersion: version, snapshot });
    return snapshot;
  };

  const tryResolveCompanion = (specifier: string, containingFile: string): string | undefined => {
    if (!isCompanionSpecifier(specifier) || !specifier.startsWith(".")) return undefined;
    const importerDir = dirname(containingFile);
    for (const candidate of companionSourceCandidates(specifier)) {
      const p = resolvePath(importerDir, candidate);
      if (host.fileExists?.(p) ?? typescript.sys.fileExists(p)) {
        const companionFileName = norm(`${resolvePath(importerDir, specifier).slice(0, -".js".length)}.ts`);
        companionSources.set(companionFileName, norm(p));
        registerCompanion(companionFileName, { sourceFile: norm(p), sourceRoot: options.sourceRoot });
        return companionFileName;
      }
    }
    return undefined;
  };

  const priorResolve = host.resolveModuleNameLiterals?.bind(host);
  host.resolveModuleNameLiterals = (literals, containingFile, redirected, opts, file, reused) => {
    // ONE base call with the full literal array: tsserver's resolution cache
    // keeps per-call bookkeeping (reusedNames correspond to the literals it
    // did NOT receive) — per-literal delegation corrupts it and crashes the
    // server in stopWatchFailedLookupLocationOfResolution. Companion entries
    // then replace their slots in the result.
    const base: readonly ts.ResolvedModuleWithFailedLookupLocations[] = priorResolve
      ? priorResolve(literals, containingFile, redirected, opts, file, reused)
      : literals.map((literal) => ({
          resolvedModule: typescript.resolveModuleName(literal.text, containingFile, opts, {
            fileExists: (f) => host.fileExists?.(f) ?? typescript.sys.fileExists(f),
            readFile: (f) => host.readFile?.(f) ?? typescript.sys.readFile(f),
          }).resolvedModule,
        }));
    return literals.map((literal, i) => {
      const companion = tryResolveCompanion(literal.text, containingFile);
      if (companion) {
        return {
          resolvedModule: {
            resolvedFileName: companion,
            extension: typescript.Extension.Ts,
            isExternalLibraryImport: false,
          },
        };
      }
      return base[i] as ts.ResolvedModuleWithFailedLookupLocations;
    });
  };

  const priorFileExists = host.fileExists?.bind(host);
  host.fileExists = (f) => (sourceFor(f) ? computeSnapshot(norm(f)) !== undefined : (priorFileExists?.(f) ?? false));

  const priorGetSnapshot = host.getScriptSnapshot.bind(host);
  host.getScriptSnapshot = (f) => {
    if (!sourceFor(f)) return priorGetSnapshot(f);
    // Under tsserver the prior chain is Project.getScriptSnapshot, whose side
    // effect mints and attaches the companion's ScriptInfo (it exists to
    // tsserver's file layer via decorateServerHostForCompanions). Without a
    // ScriptInfo, tsserver asserts on the companion in several places
    // (document-registry cache, project telemetry). The returned snapshot is
    // still ours — derived from the LIVE source snapshot, so unsaved edits
    // propagate; the ScriptInfo's disk-derived text is never user-visible.
    priorGetSnapshot(f);
    return computeSnapshot(norm(f));
  };

  const priorGetVersion = host.getScriptVersion.bind(host);
  host.getScriptVersion = (f) => {
    const source = sourceFor(f);
    return source ? `companion-of:${priorGetVersion(source)}` : priorGetVersion(f);
  };

  const priorReadFile = host.readFile?.bind(host);
  host.readFile = (f) => {
    const snapshot = sourceFor(f) ? computeSnapshot(norm(f)) : undefined;
    return snapshot ? snapshot.getText(0, snapshot.getLength()) : priorReadFile?.(f);
  };
}
