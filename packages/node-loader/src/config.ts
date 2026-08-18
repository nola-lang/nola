import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import {
  type ResolvedCompilerConfig,
  type ResolvedNolaConfig,
  resolveBuildConfig,
  resolveCompilerConfig,
  resolveNolaConfig,
} from "@nola-lang/runtime";
import { bundleConfig } from "./bundle-config.js";

// Apply a project-root `.env` into process.env before the config is evaluated, so
// `nola.config.ts` (and anything it reads, e.g. OPENAI_API_KEY) sees it. Precedence
// follows dotenv convention: an entry already set in the real environment wins, so
// shell/launch vars are never clobbered by the file.
async function applyDotEnv(dir: string): Promise<void> {
  const envPath = join(dir, ".env");
  if (!existsSync(envPath)) return;
  const parsed = parseEnv(await readFile(envPath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function findUp(startDir: string, name: string): string | null {
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

/** Evaluate nola.config.ts (bundled: relative imports inlined, packages external) via temp-module import. */
async function evalConfigModule(configPath: string): Promise<unknown> {
  await applyDotEnv(dirname(configPath));
  const code = await bundleConfig(configPath);
  const tmp = join(dirname(configPath), `nola.config.${Date.now()}.${process.pid}.mjs`);
  await writeFile(tmp, code);
  try {
    const mod = (await import(pathToFileURL(tmp).href)) as { default?: unknown };
    return mod.default;
  } finally {
    await rm(tmp, { force: true });
  }
}

export async function loadNolaConfig(startDir = process.cwd()): Promise<ResolvedNolaConfig | null> {
  const configPath = findUp(startDir, "nola.config.ts");
  if (!configPath) return null;
  return resolveNolaConfig(await evalConfigModule(configPath), { source: configPath });
}

/**
 * The `compiler` section alone, for `nola build`/`check`: validates ONLY that
 * section, so a project without a runtime-valid config (no providers yet)
 * still compiles. Defaults apply when there is no config file at all.
 */
export async function loadCompilerOptions(startDir = process.cwd()): Promise<ResolvedCompilerConfig> {
  const configPath = findUp(startDir, "nola.config.ts");
  if (!configPath) return resolveCompilerConfig(undefined);
  const raw = await evalConfigModule(configPath);
  const section = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>).compiler : undefined;
  return resolveCompilerConfig(section, configPath);
}

export interface BuildOptions {
  target: "app" | "lib";
  /** Absolute path of the governing nola.config.ts, or null when none exists. */
  configPath: string | null;
}

/**
 * The `build` section alone, for `nola build`: validates ONLY that section,
 * so a project without a runtime-valid config still builds. Also reports
 * where the config lives, so app builds can bundle it into --out.
 */
export async function loadBuildOptions(startDir = process.cwd()): Promise<BuildOptions> {
  const configPath = findUp(startDir, "nola.config.ts");
  if (!configPath) return { target: "app", configPath: null };
  const raw = await evalConfigModule(configPath);
  const section = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>).build : undefined;
  return { target: resolveBuildConfig(section, configPath).target, configPath };
}
