import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Codes } from "@nola-lang/ast";
import { isTsiSpecifier, viewSourceCandidates } from "@nola-lang/compiler";
import { diagnosticsError } from "./lower.js";
import type { ProjectContext } from "./project.js";

/**
 * The namespace a view is served in, keyed by its plain source file. A file-namespace
 * path that is not on disk never reaches a runtime `onLoad` (Bun re-resolves it and
 * then loads nothing — probed 2026-10-14), while a namespaced module resolves its own
 * imports, absolute or relative, in the runtime; the view's re-export is absolute anyway.
 */
export const VIEW_NAMESPACE = "nola-view";

/**
 * The importer as a file path. Bun's RUNTIME (`Bun.plugin`) hands `onResolve` only
 * `{ path, importer }` and spells a namespaced importer `"<namespace>:<path>"` (bun-types
 * describe the bundler's shape, which passes the bare path plus `namespace`) — a view of a
 * view (`models.ts` reaching `address.ts`) arrives as `nola-view:<abs models.ts>`, exactly
 * as unplugin sees its prefixed id. Probed on Bun 1.3.14.
 */
export function importerFile(importer: string): string {
  const prefix = `${VIEW_NAMESPACE}:`;
  return importer.startsWith(prefix) ? importer.slice(prefix.length) : importer;
}

/**
 * Loader-parity resolution (node-loader/hooks.ts, unplugin/views.ts): a real `.tsi` is
 * Bun's to serve (undefined); a miss beside the importer is the VIEW of `x.ts` / `x.d.ts`
 * (the first that exists), served in the view namespace; nothing at all is NOLA2007.
 */
export function resolveView(specifier: string, importer: string): { path: string; namespace: string } | undefined {
  if (!isTsiSpecifier(specifier)) return undefined;
  const target = resolve(dirname(importer), specifier);
  if (existsSync(target)) return undefined;
  const source = viewSourceCandidates(target).find((c) => existsSync(c));
  if (source !== undefined) return { path: source, namespace: VIEW_NAMESPACE };
  throw new Error(
    `${Codes.ViewUnavailable}: "${specifier}" (imported from ${importer}) names neither a Nola file nor a TypeScript module`,
  );
}

/** The view's TypeScript — Bun strips the types; no map (a view has no meaningful original positions). */
export function loadView(file: string, ctx: ProjectContext): string {
  const view = ctx.service.deriveView(file, { sourceSpecifier: file.replaceAll("\\", "/") });
  if (view.code === "" || view.diagnostics.length > 0) throw diagnosticsError(view.diagnostics);
  return view.code;
}
