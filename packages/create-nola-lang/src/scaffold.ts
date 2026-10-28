import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectExampleFromDisk, devExamplesDir, rewriteExamplePackageJson } from "./examples.js";
import { fetchExampleFromGitHub } from "./github.js";
import type { Runtime } from "./package-manager.js";
import { type ProviderId, providerById } from "./providers.js";
import { entryFile, type TemplateDef, templateByName, templateNames } from "./registry.js";

export interface ScaffoldResult {
  root: string;
  /** project-relative paths of every file written */
  files: string[];
}

export interface ScaffoldOptions {
  name?: string;
  /** template name; default "feature-extraction" */
  template?: string;
  /** remove existing files in a non-empty target first (set only after an interactive confirm) */
  force?: boolean;
  /**
   * The inference provider chosen in the wizard; default "none" (the
   * template's own config). Any live provider replaces `nola.config.ts` with
   * that provider's config and drops the offline templates' replay ledger.
   */
  provider?: ProviderId;
  /**
   * The editor chosen in the wizard; default "none". Decides the next-steps
   * comment that opens the template's entry file: with VS Code it names F5,
   * breakpoints and the recommended extension (all of which the .vscode
   * files the flow writes make true); without one it stays editor-neutral.
   */
  ide?: "vscode" | "none";
  /**
   * The runtime the project runs on; default "node". "bun" adds bunfig.toml with the
   * @nola-lang/bun preload, a `bun <entry>` start script, the devDependency and
   * engines.bun — build/check stay the Node CLI (spec 2026-10-14-bun-support).
   */
  runtime?: Runtime;
}

/** This package's own templates: `empty` (the one builtin), `_providers/` and `_gitignore`. */
const TEMPLATES_DIR = fileURLToPath(new URL("../templates/", import.meta.url));

/** The config a live provider choice writes over the template's own (`templates/_providers/<id>.config.ts`). */
export function providerConfigUrl(provider: Exclude<ProviderId, "none">): URL {
  return new URL(`../templates/_providers/${provider}.config.ts`, import.meta.url);
}

/**
 * The env var a scaffold's config reads: the chosen vendor's, else — under
 * "none" — the one the template's own config names (a pinned template such
 * as triage-ticket). Undefined for nola (the trial key lands in `.env`
 * itself) and for an offline scaffold.
 */
export function vendorEnvVar(template: string, provider: ProviderId): string | undefined {
  return providerById(provider)?.envVar ?? (provider === "none" ? templateByName(template)?.provider?.envVar : undefined);
}

/**
 * The `.env.example` a vendor scaffold gets: the key's slot, to copy to
 * `.env` and fill in. `.env.example` is the one env file the recommended
 * `.gitignore` keeps trackable (`!.env.example`), so it can be committed.
 */
export function envExample(envVar: string): string {
  return `# Copy to .env and fill in — \`nola run\` applies .env before evaluating nola.config.ts.\n${envVar}=\n`;
}

/** The Bun project's bunfig.toml: the preload for `bun src/main.tsi` and for `bun test`. */
export const BUNFIG_TOML = 'preload = ["@nola-lang/bun/preload"]\n\n[test]\npreload = ["@nola-lang/bun/preload"]\n';

/** The Bun floor @nola-lang/bun needs (process.getBuiltinModule). */
export const BUN_ENGINE = ">=1.3.0";

/** A Bun project's manifest additions on top of the template's: the start script, the devDependency, engines.bun. */
export function applyBunRuntime(content: string, opts: { entry: string; version: string }): string {
  const pkg = JSON.parse(content) as Record<string, unknown>;
  const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {};
  scripts.start = `bun ${opts.entry}`;
  pkg.scripts = scripts;
  const dev = (pkg.devDependencies as Record<string, string> | undefined) ?? {};
  dev["@nola-lang/bun"] = `^${opts.version}`;
  pkg.devDependencies = dev;
  const engines = (pkg.engines as Record<string, string> | undefined) ?? {};
  engines.bun = BUN_ENGINE;
  pkg.engines = engines;
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

/** The ONE recommended .gitignore — every scaffold gets it; no template keeps a copy of its own (_gitignore ships underscored: npm pack strips nested .gitignore files). */
const GITIGNORE_URL = new URL("../templates/_gitignore", import.meta.url);

/**
 * Add the recommended `.gitignore` to a template's files. Templates are
 * copied as committed — examples from `examples/`, where the monorepo's root
 * ignore file covers them — so they carry none; one a template does carry wins.
 */
export async function withRecommendedGitignore(files: Map<string, string>): Promise<Map<string, string>> {
  if (!files.has(".gitignore")) files.set(".gitignore", await readFile(GITIGNORE_URL, "utf8"));
  return files;
}

/**
 * The comment that opens the entry file (the `.tsi` entry of a one-file
 * template and of `empty`, else the plain-TS src/main.ts) — the file the
 * scaffold lands the user on (VS Code opens it as the active editor), so it
 * carries the first three things to do. The VS Code variant only ships with
 * the editor step's .vscode files, which are what make F5 and the extension
 * prompt real.
 */
export function nextStepsComment(ide: "vscode" | "none", template: string, runtime: Runtime = "node"): string {
  if (ide === "vscode") {
    // `empty`'s stub has no ask yet — the breakpoint goes on the one the user writes.
    const breakpointIn =
      template === "empty"
        ? "on your first `ask` in this file"
        : templateByName(template)?.entry
          ? "on the `ask` line below"
          : template === "typescript-interop"
            ? "in src/person.tsi"
            : "in your .tsi file";
    // A Bun project still debugs under Node's loader: the .vscode files are valid whenever Node is present.
    const runLine =
      runtime === "bun"
        ? "//   1. Run this file: bun start (F5 runs it too, under Node's loader — .vscode/launch.json is already set up)."
        : "//   1. Press F5 to run this file (.vscode/launch.json is already set up).";
    return [
      "// Next steps in VS Code:",
      runLine,
      `//   2. Set a breakpoint ${breakpointIn} and press F5 again to step through the ask.`,
      '//   3. Install the recommended "Nola" extension when VS Code offers it — IntelliSense,',
      "//      go to definition and diagnostics inside .tsi files.",
    ].join("\n");
  }
  return [
    "// Next steps:",
    `//   1. Run this file: ${runtime === "bun" ? "bun start" : "npm start"}`,
    "//   2. Set up your editor (VS Code extension, debugging): https://nola.sh/docs/start/editor-setup/",
  ].join("\n");
}

/** Template files that only make sense for the offline (replay) configuration. */
const OFFLINE_ONLY = ["nola.replay.jsonl"];

export async function ownVersion(): Promise<string> {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  return pkg.version;
}

/** Error unless target is missing/empty; with force, clears a non-empty target. */
async function prepareTarget(absRoot: string, force: boolean): Promise<void> {
  if (!existsSync(absRoot)) return;
  const entries = await readdir(absRoot);
  if (entries.length === 0) return;
  if (!force) throw new Error(`target directory ${absRoot} is not empty`);
  for (const entry of entries) await rm(join(absRoot, entry), { recursive: true, force: true });
}

/**
 * A template's files as committed: `empty` from this package's templates/
 * dir, every other template from examples/ — the dev checkout's on disk,
 * else GitHub at the lockstep tag. Everything is buffered before the caller
 * touches the target, so a failed fetch scaffolds nothing.
 */
async function collectTemplate(def: TemplateDef, version: string): Promise<Map<string, string>> {
  if (def.source === "builtin") return collectExampleFromDisk(TEMPLATES_DIR, def.name);
  const dev = await devExamplesDir();
  return dev ? collectExampleFromDisk(dev, def.name) : fetchExampleFromGitHub(def.name, version);
}

/**
 * Lay a template down into `targetDir`. One implementation serves both entry
 * points — the `create-nola-lang` bin (`npm create nola-lang`) and `nola init`
 * — and both sources: the files are collected as committed, then the scaffold
 * adds what a project needs on top — the chosen provider's config (dropping
 * the replay ledger), the project name and the lockstep ranges in
 * package.json, the recommended .gitignore, the vendor key's .env.example,
 * and the next-steps comment at the top of the entry file.
 */
export async function scaffold(targetDir: string, opts: ScaffoldOptions = {}): Promise<ScaffoldResult> {
  const root = targetDir;
  const absRoot = resolve(targetDir);
  const template = opts.template ?? "feature-extraction";
  const def = templateByName(template);
  if (!def) throw new Error(`unknown template "${template}" (valid: ${templateNames().join(", ")})`);
  const version = await ownVersion();
  const files = await collectTemplate(def, version);
  await prepareTarget(absRoot, opts.force ?? false);
  const name = opts.name ?? basename(absRoot);
  const provider = opts.provider ?? "none";
  const runtime = opts.runtime ?? "node";
  const entry = entryFile(template);

  // A live provider's config replaces the template's own; the ledger it replayed goes with it.
  if (provider !== "none") {
    for (const offline of OFFLINE_ONLY) files.delete(offline);
    files.set("nola.config.ts", await readFile(providerConfigUrl(provider), "utf8"));
  }
  const manifest = files.get("package.json");
  if (manifest) files.set("package.json", rewriteExamplePackageJson(manifest, { name, version }));
  // A Bun project (spec 2026-10-14-bun-support): the preload, a `bun <entry>` start script, the devDependency, engines.bun.
  if (runtime === "bun") {
    files.set("bunfig.toml", BUNFIG_TOML);
    const current = files.get("package.json");
    if (current !== undefined) files.set("package.json", applyBunRuntime(current, { entry, version }));
  }
  await withRecommendedGitignore(files);
  const envVar = vendorEnvVar(template, provider);
  if (envVar !== undefined && !files.has(".env.example")) files.set(".env.example", envExample(envVar));
  // The entry file greets the user with the next steps — it is what VS Code opens.
  const program = files.get(entry);
  if (program !== undefined) files.set(entry, `${nextStepsComment(opts.ide ?? "none", template, runtime)}\n\n${program}`);

  for (const [relPath, content] of files) {
    const target = join(absRoot, relPath);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content);
  }
  return { root, files: [...files.keys()].sort() };
}
