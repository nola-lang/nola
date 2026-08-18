import type ts from "typescript";

const PATCHED = Symbol.for("nola.documentCacheGuard");

interface ProjectServiceInternals {
  [PATCHED]?: true;
  setDocument?(key: unknown, path: ts.Path, sourceFile: unknown): void;
  getScriptInfoForPath?(path: ts.Path): unknown;
}

/**
 * tsserver's DocumentRegistry uses the ProjectService as an external source
 * file cache and ASSERTS that every cached path has a ScriptInfo
 * (`Debug.checkDefined` in ProjectService.setDocument). Synthetic companion
 * modules are host-level scripts with no on-disk file: tsserver's
 * watch/ScriptInfo lifecycle drops their info shortly after creation, and
 * from then on EVERY program rebuild (any edit) dies in that assert —
 * diagnostics freeze until the file is closed and reopened. The cache is
 * genuinely optional (getDocument is already null-safe), so skip the write
 * when no ScriptInfo exists instead of crashing.
 *
 * setDocument/getScriptInfoForPath are @internal API — the guard no-ops
 * gracefully if a future TypeScript renames them. One ProjectService serves
 * every project, so the patch applies once per instance.
 */
export function guardProjectServiceDocumentCache(projectService: unknown): void {
  const ps = projectService as ProjectServiceInternals;
  if (ps[PATCHED] || typeof ps.setDocument !== "function" || typeof ps.getScriptInfoForPath !== "function") return;
  ps[PATCHED] = true;
  const prior = ps.setDocument.bind(ps);
  ps.setDocument = (key, path, sourceFile) => {
    if (!ps.getScriptInfoForPath?.(path)) return;
    prior(key, path, sourceFile);
  };
}
