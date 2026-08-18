import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Build/install output never copied from a dev checkout's example dir. */
const COPY_EXCLUDE = new Set(["node_modules", "dist"]);

/**
 * The repo's examples/ dir when running inside the nola-monorepo checkout
 * (dev mode), else null. Both this module's src/ and dist/ locations sit two
 * levels below the repo root's packages/ dir.
 */
export async function devExamplesDir(): Promise<string | null> {
  const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const rootManifest = join(repoRoot, "package.json");
  if (!existsSync(rootManifest)) return null;
  try {
    const pkg = JSON.parse(await readFile(rootManifest, "utf8")) as { name?: string };
    if (pkg.name !== "nola-monorepo") return null;
  } catch {
    return null;
  }
  const dir = join(repoRoot, "examples");
  return existsSync(dir) ? dir : null;
}

/** rel-path → content for one example, from the dev checkout's examples dir. */
export async function collectExampleFromDisk(examplesDir: string, name: string): Promise<Map<string, string>> {
  const root = join(examplesDir, name);
  if (!existsSync(root)) throw new Error(`unknown example "${name}" (no ${root})`);
  const files = new Map<string, string>();
  const walk = async (rel: string): Promise<void> => {
    for (const entry of await readdir(join(root, rel), { withFileTypes: true })) {
      if (COPY_EXCLUDE.has(entry.name) || entry.name.endsWith(".tsbuildinfo")) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(relPath);
      else files.set(relPath, await readFile(join(root, relPath), "utf8"));
    }
  };
  await walk("");
  return files;
}

/**
 * Structured rewrite for a scaffolded example's package.json — examples stay
 * runnable workspaces in-repo, so they carry no __NAME__ placeholders.
 */
export function rewriteExamplePackageJson(content: string, opts: { name: string; version: string }): string {
  const pkg = JSON.parse(content) as Record<string, unknown>;
  pkg.name = opts.name;
  for (const section of ["dependencies", "devDependencies"]) {
    const deps = pkg[section] as Record<string, string> | undefined;
    if (!deps) continue;
    for (const [dep, range] of Object.entries(deps)) {
      if (range === "*" && (dep === "nola-lang" || dep.startsWith("@nola-lang/"))) {
        deps[dep] = `^${opts.version}`;
      }
    }
  }
  return `${JSON.stringify(pkg, null, 2)}\n`;
}
