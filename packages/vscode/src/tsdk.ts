import { join } from "node:path";

/**
 * The tsdk directory the language server loads TypeScript from. The workspace's
 * own install wins (parity with the tsserver plugin, which runs under the
 * workspace TS version); VS Code's bundled TypeScript is the fallback. Never
 * resolve relative to the extension — an installed VSIX has no node_modules
 * above it.
 */
export function resolveTsdk(opts: {
  workspaceFolders: readonly string[];
  appRoot: string;
  exists: (path: string) => boolean;
}): string | undefined {
  const candidates = [
    ...opts.workspaceFolders.map((folder) => join(folder, "node_modules", "typescript", "lib")),
    join(opts.appRoot, "extensions", "node_modules", "typescript", "lib"),
  ];
  return candidates.find((dir) => opts.exists(join(dir, "typescript.js")));
}
