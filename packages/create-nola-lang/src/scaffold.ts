import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectExampleFromDisk, devExamplesDir, rewriteExamplePackageJson } from "./examples.js";
import { fetchExampleFromGitHub } from "./github.js";
import { type ProviderId, providerById } from "./providers.js";
import { templateByName, templateNames } from "./registry.js";

export interface ScaffoldResult {
  root: string;
  /** project-relative paths of every file written */
  files: string[];
}

export interface ScaffoldOptions {
  name?: string;
  /** template name; default "starter" */
  template?: string;
  /** remove existing files in a non-empty target first (set only after an interactive confirm) */
  force?: boolean;
  /**
   * The inference provider chosen in the wizard; default "none" (the
   * template's own config). Any live provider replaces `nola.config.ts` with
   * that provider's config, skips the starter's replay ledger, and renders
   * the matching README notes.
   */
  provider?: ProviderId;
}

const TEMPLATES_DIR = fileURLToPath(new URL("../templates/", import.meta.url));

/** The config a live provider choice writes over the template's own (`templates/_providers/<id>.config.ts`). */
export function providerConfigUrl(provider: Exclude<ProviderId, "none">): URL {
  return new URL(`../templates/_providers/${provider}.config.ts`, import.meta.url);
}

/** _gitignore ships underscored (npm pack strips nested .gitignore files). */
const RENAMES: Record<string, string> = { _gitignore: ".gitignore" };

/** Files whose __NAME__/__VERSION__ (and README note) placeholders are substituted. */
const SUBSTITUTED = new Set(["package.json", "README.md"]);

/** Starter files that only make sense for the offline (replay) configuration. */
const OFFLINE_ONLY = new Set(["nola.replay.jsonl"]);

const README_NOTES = {
  offline: {
    START_NOTE: "works offline, no API key needed",
    PROVIDER_NOTE:
      "The starter runs offline: `nola.config.ts` replays answers from the committed\n" +
      "`nola.replay.jsonl` ledger. The ledger is keyed by the exact prompt, so once\n" +
      "you edit `src/person.tsi` or add your own asks, switch the config to a real\n" +
      "model (see the comment in `nola.config.ts`) and set `OPENAI_API_KEY`.",
  },
  nola: {
    START_NOTE: "uses your 25 free Nola runs (key in .env)",
    PROVIDER_NOTE:
      "`nola.config.ts` sets `model: nola.infer()` — platform-served inference with the trial key the\n" +
      "scaffold wrote to `.env` (git-ignored). Out of runs? `npx nola-lang account` opens\n" +
      "your Nola account, where prepaid balance is added, or bring your\n" +
      "own model (see the comment in `nola.config.ts`).",
  },
} as const;

type ReadmeNotes = { START_NOTE: string; PROVIDER_NOTE: string };

/** The README notes for a chosen provider: offline, the Nola trial, or a vendor and the env var its factory reads. */
function readmeNotes(provider: ProviderId): ReadmeNotes {
  if (provider === "none") return README_NOTES.offline;
  if (provider === "nola") return README_NOTES.nola;
  const def = providerById(provider);
  if (!def?.envVar || !def.model) throw new Error(`provider "${provider}" has no vendor config`);
  return {
    START_NOTE: `set ${def.envVar} in .env first`,
    PROVIDER_NOTE:
      `\`nola.config.ts\` sets \`model: ${def.model}\` — ${def.label} serves inference with the key it reads\n` +
      `from \`${def.envVar}\`. Put \`${def.envVar}=…\` in \`.env\` (git-ignored; \`nola run\` applies it) before the\n` +
      "first `npm start`, or switch models in `nola.config.ts`.",
  };
}

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
 * Lay a template down into `targetDir`. One implementation serves both entry
 * points: the `create-nola-lang` bin (`npm create nola-lang`) and `nola init`.
 */
export async function scaffold(targetDir: string, opts: ScaffoldOptions = {}): Promise<ScaffoldResult> {
  const root = targetDir;
  const absRoot = resolve(targetDir);
  const template = opts.template ?? "starter";
  const def = templateByName(template);
  if (!def) throw new Error(`unknown template "${template}" (valid: ${templateNames().join(", ")})`);
  await prepareTarget(absRoot, opts.force ?? false);
  const name = opts.name ?? basename(absRoot);
  const version = await ownVersion();

  if (def.source === "example") {
    const dev = await devExamplesDir();
    const exampleFiles = dev ? await collectExampleFromDisk(dev, template) : await fetchExampleFromGitHub(template, version);
    const manifest = exampleFiles.get("package.json");
    if (manifest) exampleFiles.set("package.json", rewriteExamplePackageJson(manifest, { name, version }));
    for (const [relPath, content] of exampleFiles) {
      const target = join(absRoot, relPath);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, content);
    }
    return { root, files: [...exampleFiles.keys()].sort() };
  }

  const templateRoot = join(TEMPLATES_DIR, template);
  const versionRange = `^${version}`;
  const provider = opts.provider ?? "none";
  const notes = readmeNotes(provider);
  const files: string[] = [];
  const copyDir = async (fromDir: string, relDir: string): Promise<void> => {
    await mkdir(join(absRoot, relDir), { recursive: true });
    for (const entry of await readdir(join(templateRoot, fromDir), { withFileTypes: true })) {
      const fromRel = join(fromDir, entry.name);
      if (entry.isDirectory()) {
        await copyDir(fromRel, join(relDir, entry.name));
        continue;
      }
      const toName = RENAMES[entry.name] ?? entry.name;
      if (provider !== "none" && OFFLINE_ONLY.has(entry.name)) continue;
      const toRel = join(relDir, toName);
      // A live provider's config replaces the template's own (both builtin templates keep it at the root).
      const source =
        provider !== "none" && relDir === "." && entry.name === "nola.config.ts"
          ? providerConfigUrl(provider)
          : join(templateRoot, fromRel);
      let content = await readFile(source, "utf8");
      if (SUBSTITUTED.has(entry.name)) {
        content = content
          .replaceAll("__NAME__", name)
          .replaceAll("__VERSION__", versionRange)
          .replaceAll("__START_NOTE__", notes.START_NOTE)
          .replaceAll("__PROVIDER_NOTE__", notes.PROVIDER_NOTE);
      }
      await writeFile(join(absRoot, toRel), content);
      files.push(toRel.replaceAll("\\", "/"));
    }
  };
  await copyDir(".", ".");
  return { root, files: files.sort() };
}
