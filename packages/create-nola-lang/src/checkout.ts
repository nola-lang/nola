import { existsSync } from "node:fs";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The nola-monorepo root when this module runs from inside the dev checkout
 * (both src/ and dist/ sit two levels below the root's packages/ dir), else
 * null. A published copy lives under node_modules and never matches.
 */
export async function checkoutRoot(): Promise<string | null> {
  const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const rootManifest = join(repoRoot, "package.json");
  if (!existsSync(rootManifest)) return null;
  try {
    const pkg = JSON.parse(await readFile(rootManifest, "utf8")) as { name?: string };
    return pkg.name === "nola-monorepo" ? repoRoot : null;
  } catch {
    return null;
  }
}

/**
 * The packages a scaffold depends on directly, as package name → workspace
 * dir. Their internal deps resolve through the junction's real path into the
 * checkout's hoisted node_modules, so nothing else needs linking.
 */
const LINKS: ReadonlyArray<readonly [name: string, dir: string]> = [
  ["@nola-lang/runtime", "runtime"],
  ["@nola-lang/providers", "providers"],
  ["nola-lang", "nola-lang"],
];

/**
 * Dev-only switch: the absolute path of a nola-monorepo checkout. When set,
 * the init flow relinks a freshly installed scaffold to that checkout's
 * packages/ (see linkCheckoutPackages). An env var rather than detection so
 * a CLI installed outside the monorepo can be pointed at it while testing.
 */
export const LINK_CHECKOUT_ENV = "NOLA_LINK_CHECKOUT";

/** The checkout root NOLA_LINK_CHECKOUT names, or null when unset/blank. */
export function linkCheckoutFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env[LINK_CHECKOUT_ENV]?.trim();
  return value ? value : null;
}

export const CHECKOUT_LINKED_PACKAGES: readonly string[] = LINKS.map(([name]) => name);

/**
 * Dev mode only: replace the scaffold's registry copies of the Nola packages
 * with junctions into the checkout's packages/, so a `nola init` run from a
 * linked CLI tests the workspace build instead of the last npm release.
 * Returns the linked package names.
 */
export async function linkCheckoutPackages(dir: string, root: string): Promise<string[]> {
  const linked: string[] = [];
  for (const [name, pkg] of LINKS) {
    const target = join(root, "packages", pkg);
    const link = join(dir, "node_modules", name);
    await mkdir(dirname(link), { recursive: true });
    // rm lstat's its path: an existing junction is unlinked, never descended.
    await rm(link, { recursive: true, force: true });
    await symlink(target, link, "junction");
    linked.push(name);
  }
  return linked;
}

/**
 * The skipFiles glob the in-repo dogfood launch configs carry. Node resolves
 * a junction to its real path, so a linked scaffold runs the runtime from
 * <checkout>/packages/\*\/dist — outside node_modules, which is all the
 * scaffolded launch.json skips. Left unskipped, js-debug loses F10 over the
 * process's first network ask: V8's step-over of the top-level await stays a
 * plain step, lands on js-debug's injected WebAssembly pause (undici compiling
 * its HTTP parser for the first fetch), and js-debug resumes that pause
 * without re-stepping, so the program runs to the end (VS Code trace,
 * 2026-09-18). Blackboxing the dist restores the step.
 */
export const CHECKOUT_DIST_SKIP_GLOB = "**/packages/*/dist/**";

interface LaunchConfigLike {
  skipFiles?: unknown;
}

/**
 * Dev mode only, after linkCheckoutPackages: add CHECKOUT_DIST_SKIP_GLOB to
 * every configuration's skipFiles in the scaffold's .vscode/launch.json.
 * Returns true when the file changed; false when there is no launch.json, it
 * is not plain JSON (a hand-edited one with comments is the user's), or every
 * configuration already carries the glob.
 */
export async function skipCheckoutDistInLaunch(dir: string): Promise<boolean> {
  const path = join(dir, ".vscode", "launch.json");
  if (!existsSync(path)) return false;
  let launch: { configurations?: unknown };
  try {
    launch = JSON.parse(await readFile(path, "utf8")) as { configurations?: unknown };
  } catch {
    return false;
  }
  if (!Array.isArray(launch.configurations)) return false;
  let changed = false;
  for (const config of launch.configurations as LaunchConfigLike[]) {
    if (typeof config !== "object" || config === null) continue;
    const skipFiles = Array.isArray(config.skipFiles) ? (config.skipFiles as unknown[]) : [];
    if (skipFiles.includes(CHECKOUT_DIST_SKIP_GLOB)) continue;
    config.skipFiles = [...skipFiles, CHECKOUT_DIST_SKIP_GLOB];
    changed = true;
  }
  if (!changed) return false;
  await writeFile(path, `${JSON.stringify(launch, null, 2)}\n`);
  return true;
}
