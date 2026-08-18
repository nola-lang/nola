import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectExampleFromDisk, devExamplesDir, rewriteExamplePackageJson } from "./examples.js";
import { fetchExampleFromGitHub } from "./github.js";
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
}

const TEMPLATES_DIR = fileURLToPath(new URL("../templates/", import.meta.url));

/** _gitignore ships underscored (npm pack strips nested .gitignore files). */
const RENAMES: Record<string, string> = { _gitignore: ".gitignore" };

/** Files whose __NAME__/__VERSION__ placeholders are substituted. */
const SUBSTITUTED = new Set(["package.json", "README.md"]);

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
      const toRel = join(relDir, toName);
      let content = await readFile(join(templateRoot, fromRel), "utf8");
      if (SUBSTITUTED.has(entry.name)) {
        content = content.replaceAll("__NAME__", name).replaceAll("__VERSION__", versionRange);
      }
      await writeFile(join(absRoot, toRel), content);
      files.push(toRel.replaceAll("\\", "/"));
    }
  };
  await copyDir(".", ".");
  return { root, files: files.sort() };
}
