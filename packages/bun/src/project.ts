import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDerivationService, type DerivationService } from "@nola-lang/derive";
import { findProjectRoot } from "@nola-lang/node-loader/project-root";
import { type NolaConfig, resolveBuildConfig, resolveCompilerConfig } from "@nola-lang/runtime";

export interface NolaBunOptions {
  /** default: build.target from nola.config.ts ("app" when absent) */
  target?: "app" | "lib";
  /** config path override, or false to disable the wiring import (the preload passes false) */
  config?: string | false;
}

export interface ProjectContext {
  /** the project root: the nearest nola.config.ts dir, else the file's dir (the loader's rule) */
  root: string;
  underivableContextType: "error" | "prune" | "omit";
  target: "app" | "lib";
  /** the governing nola.config.ts, or null when none exists */
  configPath: string | null;
  /** the config module's default export, evaluated ONCE per root — what the preload hands to configure() */
  config: NolaConfig | null;
  /** append the wiring import to app-target modules in bundle mode; false without a config or under `config: false` */
  wire: boolean;
  /** the checker that fills the appendix accessors (emit 15) — one per project root per process */
  service: DerivationService;
}

export type ConfigEvaluator = (configPath: string) => Promise<unknown>;

/** Bun runs TypeScript natively and loads .env itself: the config is a plain import, no bundling. Tests inject an evaluator. */
const importConfig: ConfigEvaluator = async (configPath) => {
  const mod = (await import(pathToFileURL(configPath).href)) as { default?: unknown };
  return mod.default;
};
let evaluator: ConfigEvaluator = importConfig;

export function setConfigEvaluator(fn: ConfigEvaluator | undefined): void {
  evaluator = fn ?? importConfig;
}

// One context per project root — a .tsi import graph is many files, few roots.
const contexts = new Map<string, Promise<ProjectContext>>();

export function projectFor(file: string, options: NolaBunOptions = {}): Promise<ProjectContext> {
  return projectForDir(dirname(file), options);
}

export function projectForDir(dir: string, options: NolaBunOptions = {}): Promise<ProjectContext> {
  const root = findProjectRoot(dir);
  const key = `${root} ${JSON.stringify(options)}`;
  let ctx = contexts.get(key);
  if (ctx === undefined) {
    ctx = load(root, options);
    contexts.set(key, ctx);
  }
  return ctx;
}

async function load(root: string, options: NolaBunOptions): Promise<ProjectContext> {
  let configPath: string | null;
  if (typeof options.config === "string") {
    configPath = resolve(options.config);
    if (!existsSync(configPath)) throw new Error(`@nola-lang/bun: config "${configPath}" not found`);
  } else {
    const candidate = join(root, "nola.config.ts");
    configPath = existsSync(candidate) ? candidate : null;
  }
  let config: NolaConfig | null = null;
  if (configPath !== null) {
    const value = await evaluator(configPath);
    if (value === undefined || value === null) {
      throw new Error(`@nola-lang/bun: ${configPath} has no default export — write \`export default defineConfig({ ... })\``);
    }
    config = value as NolaConfig;
  }
  const raw = (config ?? {}) as Record<string, unknown>;
  const compiler = resolveCompilerConfig(raw.compiler, configPath ?? undefined);
  const target = options.target ?? resolveBuildConfig(raw.build, configPath ?? undefined).target;
  return {
    root,
    underivableContextType: compiler.underivableContextType,
    target,
    configPath,
    config,
    wire: options.config !== false && configPath !== null,
    service: createDerivationService({ projectRoot: root, sourceRoot: root, underivableContextType: compiler.underivableContextType }),
  };
}

/** Test seam: drop memoized contexts (and dispose their services). */
export function resetProjects(): void {
  for (const ctx of contexts.values()) void ctx.then((c) => c.service.dispose()).catch(() => {});
  contexts.clear();
}
