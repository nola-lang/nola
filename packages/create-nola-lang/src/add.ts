import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ownVersion } from "./scaffold.js";

export interface AddResult {
  /** files written, e.g. ["nola.config.ts", "package.json"] */
  wrote: string[];
  /** deps added, as "name@range" */
  added: string[];
  /** human-readable notes about what was left untouched */
  skipped: string[];
  /** true when nothing needed doing */
  alreadySetUp: boolean;
}

/** The retrofit config is the empty template's — a retrofit has no replay ledger. */
const EMPTY_CONFIG_URL = new URL("../templates/empty/nola.config.ts", import.meta.url);

/** null range = "^<lockstep version>"; typescript is NOT lockstep, it keeps the template pin. */
const REQUIRED: readonly ["dependencies" | "devDependencies", string, string | null][] = [
  ["dependencies", "@nola-lang/runtime", null],
  ["dependencies", "@nola-lang/providers", null],
  ["devDependencies", "nola-lang", null],
  ["devDependencies", "typescript", "^5.6.0"],
];

/**
 * Retrofit an existing npm project: write nola.config.ts (unless present) and
 * additively merge the required packages. Never rewrites existing entries.
 */
export async function addNola(targetDir: string, opts: { version?: string } = {}): Promise<AddResult> {
  const absRoot = resolve(targetDir);
  const manifestPath = join(absRoot, "package.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`no package.json in ${absRoot} — run without --add to scaffold a new project`);
  }
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`could not parse ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const wrote: string[] = [];
  const added: string[] = [];
  const skipped: string[] = [];
  const lockstep = `^${opts.version ?? (await ownVersion())}`;

  const existingRange = (name: string): string | undefined => {
    for (const section of ["dependencies", "devDependencies"]) {
      const deps = pkg[section] as Record<string, string> | undefined;
      if (deps && name in deps) return deps[name];
    }
    return undefined;
  };

  const configPath = join(absRoot, "nola.config.ts");
  if (existsSync(configPath)) {
    skipped.push("nola.config.ts already exists — left untouched");
  } else {
    await writeFile(configPath, await readFile(EMPTY_CONFIG_URL, "utf8"));
    wrote.push("nola.config.ts");
  }

  for (const [section, name, fixedRange] of REQUIRED) {
    const existing = existingRange(name);
    if (existing !== undefined) {
      skipped.push(`${name} already present (${existing}) — left untouched`);
      continue;
    }
    const range = fixedRange ?? lockstep;
    const deps = (pkg[section] as Record<string, string> | undefined) ?? {};
    pkg[section] = deps;
    deps[name] = range;
    added.push(`${name}@${range}`);
  }

  if (added.length > 0) {
    await writeFile(manifestPath, `${JSON.stringify(pkg, null, 2)}\n`);
    wrote.push("package.json");
  }

  return { wrote, added, skipped, alreadySetUp: wrote.length === 0 && added.length === 0 };
}
