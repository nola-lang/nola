import type ts from "typescript";

/**
 * Re-resolution bridge for deleted-then-recreated `.tsi` imports.
 *
 * Volar's host decoration resolves a `.tsi`-suffixed literal with its OWN
 * resolver (it intercepts probes for the phantom `x.d.tsi.ts` and checks the
 * real `x.tsi`), bypassing tsserver's resolution cache for those literals.
 * Two consequences when the target file is missing: the recorded failed
 * lookups name only the phantom paths, and — worse — tsserver never sees the
 * resolution at all, so it installs no failed-lookup watcher and has no
 * trigger to ever re-resolve. Deleting a `.tsi` produced TS2307 immediately
 * (it was a watched program file), but re-creating it left the error stuck
 * until the importing file was closed and reopened.
 *
 * This decoration wraps the (Volar-decorated) `resolveModuleNameLiterals`:
 * when a relative `.tsi` literal fails to resolve, it watches the candidate
 * path via the ServerHost; on any event it marks the importing files'
 * resolutions invalidated, dirties the project, and refreshes diagnostics —
 * the next program synchronize then re-resolves exactly those files. The
 * watcher is PERSISTENT (never closed once armed): after the delete/revive
 * cycle the revived ScriptInfo reloads content but no longer dirties the
 * project on change (verified: a stale TS2305 cleared instantly on an
 * unrelated nudge), so the same watcher doubles as the change trigger for
 * every later edit of that file — content restored, emptied again, or
 * re-deleted. Must be installed AFTER Volar's decoration (the plugin's
 * `setup` hook) so the wrapped prior is the resolver that actually handles
 * `.tsi`.
 */
export function decorateHostForTsiResolutionWatch(
  host: ts.LanguageServiceHost,
  serverHost: ts.server.ServerHost,
  project: ts.server.Project,
  extensions: string[],
): void {
  const prior = host.resolveModuleNameLiterals?.bind(host);
  if (!prior) return;
  // 500 = tsserver's PollingInterval.Medium; the polling fallback watcher
  // requires an explicit interval (undefined throws in Node's fs.watchFile).
  const watchFile = (path: string, cb: ts.FileWatcherCallback): ts.FileWatcher =>
    (serverHost.watchFile as (p: string, c: ts.FileWatcherCallback, interval?: number) => ts.FileWatcher)(
      path,
      cb,
      500,
    );

  const caseSensitive =
    typeof host.useCaseSensitiveFileNames === "function"
      ? host.useCaseSensitiveFileNames()
      : (host.useCaseSensitiveFileNames ?? false);
  const canon = (fileName: string): string => {
    const posix = fileName.replace(/\\/g, "/");
    return caseSensitive ? posix : posix.toLowerCase();
  };

  const watched = new Map<string, { watcher: ts.FileWatcher; waiters: Set<string> }>();
  const invalidated = new Set<string>();

  const hostWithInvalidation = host as ts.LanguageServiceHost & {
    hasInvalidatedResolutions?: (path: ts.Path) => boolean;
  };
  // markAsDirty is internal-but-stable: it bumps the project version so the
  // next synchronize actually rebuilds the program.
  const projectWithDirty = project as ts.server.Project & { markAsDirty?: () => void };

  // Project.updateGraphWorker REASSIGNS `this.hasInvalidatedResolutions` on
  // every graph update (from its resolutionCache), so a plain property
  // override is clobbered before synchronizeHostData ever reads it. An
  // accessor keeps ours composed on top: the setter captures tsserver's
  // function as the inner delegate, the getter serves the composition.
  let innerHasInvalidated = hostWithInvalidation.hasInvalidatedResolutions;
  const composedHasInvalidated = (path: ts.Path): boolean =>
    invalidated.has(canon(path)) || (innerHasInvalidated?.(path) ?? false);
  Object.defineProperty(host, "hasInvalidatedResolutions", {
    configurable: true,
    get: () => composedHasInvalidated,
    set: (fn: (path: ts.Path) => boolean) => {
      innerHasInvalidated = fn;
    },
  });

  host.resolveModuleNameLiterals = (moduleLiterals, containingFile, ...rest) => {
    const containing = canon(containingFile);
    invalidated.delete(containing);
    const results = prior(moduleLiterals, containingFile, ...rest);
    for (let i = 0; i < moduleLiterals.length; i++) {
      const text = moduleLiterals[i]?.text ?? "";
      if (!text.startsWith("./") && !text.startsWith("../")) continue;
      if (!extensions.some((ext) => text.endsWith(ext))) continue;
      const dir = containingFile.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
      const candidate = canon(`${dir}/${text}`.replace(/\/\.\//g, "/"));
      const entry = watched.get(candidate);
      if (entry) {
        entry.waiters.add(containing);
        continue;
      }
      // arm only on failure; a healthy never-deleted file keeps tsserver's own
      // ScriptInfo watching and needs no bridge
      if (results[i]?.resolvedModule) continue;
      const waiters = new Set([containing]);
      const watcher = watchFile(candidate, () => {
        for (const waiter of waiters) invalidated.add(waiter);
        projectWithDirty.markAsDirty?.();
        project.refreshDiagnostics();
      });
      watched.set(candidate, { watcher, waiters });
    }
    return results;
  };
}
