// Runtime-free on purpose: the editor bundles (language server, tsserver
// plugin) need only findProjectRoot, and importing it through the package
// index would evaluate register.ts/config.ts and inline the whole runtime —
// a slot claim in an editor process plus `import.meta.url` in a CJS bundle.
// They import `@nola-lang/node-loader/project-root`; this file must never
// gain a runtime import.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** The nearest `name` at or above `startDir`, else null. */
export function findUp(startDir: string, name: string): string | null {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The project root: the directory holding the nearest `nola.config.ts`, else `startDir`.
 * Used to relativize the paths baked into lowered output, so `dist/` never carries the
 * build machine's directory layout.
 *
 * Always absolute — `displayPathFor` prefix-matches this against an absolute file path,
 * and a relative root would match nothing and silently fall back to emitting the
 * absolute path.
 */
export function findProjectRoot(startDir = process.cwd()): string {
  const from = resolve(startDir);
  const configPath = findUp(from, "nola.config.ts");
  return configPath ? dirname(configPath) : from;
}
