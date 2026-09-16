import { RUNTIME_AMBIENT_STUB } from "@nola-lang/compiler";
import type ts from "typescript";

/**
 * The virtual file the stub is served under — the same path `nola check`
 * (tshost) uses for its bare-project fallback, so both tools name the one
 * surface the same way.
 */
export const RUNTIME_STUB_FILE = "/__nola_stubs__/runtime.d.ts";

const RUNTIME_SPECIFIER = "@nola-lang/runtime";

function norm(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Serves the compiler's ambient stub as `@nola-lang/runtime` whenever that
 * specifier does NOT resolve from the importing file — the installed package
 * wins every time it exists.
 *
 * Why: lowered code imports the runtime in its appendix. In a project where
 * the package is not installed yet (the window between `npm create nola` and
 * `npm install`, or a bare `.tsi` opened on its own) that import fails, and
 * because the appendix is unmapped the TS2307 never reaches the editor —
 * only its derivative does: `__nola` is `any`, so the wrapper's
 * `(__frame) => …` loses its contextual type and the user sees "Parameter
 * '__frame' implicitly has an 'any' type" on the infer function header.
 * `nola check` answers the same situation with RUNTIME_AMBIENT_STUB (tshost's
 * bare-project fallback); the editor hosts do the same here, so a .tsi is
 * fully typed before the install and the editor agrees with `nola check`.
 *
 * The stub is resolved as an external-library file (no diagnostics of its
 * own, like anything under node_modules) and served through the same four
 * host seams views use: resolveModuleNameLiterals (ONE batch call to the
 * prior resolver — the full literal array, never per literal; see
 * view-host.ts for why tsserver's resolution cache needs that),
 * fileExists / readFile / getScriptSnapshot / getScriptVersion.
 *
 * Note the stale window: Volar's language server caches a failed lookup until
 * a watched-file event for that very path, and VS Code never reports
 * `node_modules` changes (files.watcherExclude) — so after `npm install` the
 * stub keeps serving until the window reloads. That is benign by design: the
 * stub and the real `__nola` surface are held in lockstep
 * (emit-surface.test.ts), so types do not change, only F12 targets do.
 */
export function decorateHostWithRuntimeStub(typescript: typeof ts, host: ts.LanguageServiceHost): void {
  const isStub = (f: string): boolean => norm(f) === RUNTIME_STUB_FILE;
  let snapshot: ts.IScriptSnapshot | undefined;
  const stubSnapshot = (): ts.IScriptSnapshot => {
    snapshot ??= typescript.ScriptSnapshot.fromString(RUNTIME_AMBIENT_STUB);
    return snapshot;
  };

  const priorResolve = host.resolveModuleNameLiterals?.bind(host);
  host.resolveModuleNameLiterals = (literals, containingFile, redirected, opts, file, reused) => {
    const base: readonly ts.ResolvedModuleWithFailedLookupLocations[] = priorResolve
      ? priorResolve(literals, containingFile, redirected, opts, file, reused)
      : literals.map((literal) =>
          typescript.resolveModuleName(literal.text, containingFile, opts, {
            fileExists: (f) => host.fileExists?.(f) ?? typescript.sys.fileExists(f),
            readFile: (f) => host.readFile?.(f) ?? typescript.sys.readFile(f),
            directoryExists: host.directoryExists?.bind(host),
            realpath: host.realpath?.bind(host),
          }),
        );
    return literals.map((literal, i) => {
      const result = base[i] as ts.ResolvedModuleWithFailedLookupLocations;
      if (literal.text !== RUNTIME_SPECIFIER || result.resolvedModule) return result;
      return {
        resolvedModule: {
          resolvedFileName: RUNTIME_STUB_FILE,
          extension: typescript.Extension.Dts,
          isExternalLibraryImport: true,
        },
      };
    });
  };

  const priorFileExists = host.fileExists?.bind(host);
  host.fileExists = (f) => isStub(f) || (priorFileExists?.(f) ?? false);

  const priorReadFile = host.readFile?.bind(host);
  host.readFile = (f, encoding) => (isStub(f) ? RUNTIME_AMBIENT_STUB : priorReadFile?.(f, encoding));

  const priorGetSnapshot = host.getScriptSnapshot.bind(host);
  host.getScriptSnapshot = (f) => (isStub(f) ? stubSnapshot() : priorGetSnapshot(f));

  const priorGetVersion = host.getScriptVersion.bind(host);
  host.getScriptVersion = (f) => (isStub(f) ? "nola-runtime-stub" : priorGetVersion(f));
}
