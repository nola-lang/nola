import { existsSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/** The canonical `model: "nola"` config every template gets when Nola is the chosen provider. */
export const TRIAL_CONFIG_URL = new URL("../templates/_providers/nola.config.ts", import.meta.url);
export const ENV_KEY = "NOLA_API_KEY";
const IGNORE_LINES = [".env", ".env.*"] as const;

export interface TrialApplyResult {
  /** project-relative files written or appended */
  wrote: string[];
  /** human-readable notes about what was left untouched */
  skipped: string[];
}

const ENV_KEY_LINE = new RegExp(`^\\s*(?:export\\s+)?${ENV_KEY}\\s*=`, "m");

/** Whether `<dir>/.env` already sets NOLA_API_KEY. */
export async function hasEnvKey(dir: string): Promise<boolean> {
  return (await readEnvKey(dir)) !== undefined;
}

/** The NOLA_API_KEY value in `<dir>/.env` (first match, quotes stripped), or undefined. */
export async function readEnvKey(dir: string): Promise<string | undefined> {
  const envPath = join(resolve(dir), ".env");
  if (!existsSync(envPath)) return undefined;
  const match = new RegExp(`^\\s*(?:export\\s+)?${ENV_KEY}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s#]*)`, "m").exec(await readFile(envPath, "utf8"));
  if (!match?.[1]) return undefined;
  const raw = match[1];
  const value = /^["']/.test(raw) ? raw.slice(1, -1) : raw;
  return value === "" ? undefined : value;
}

/**
 * Put a key into `<dir>/.env` — appended; an existing NOLA_API_KEY entry is
 * left alone unless `replace` is set, in which case its line is rewritten in
 * place (an `export ` prefix survives). Touches NOTHING else — `nola key`
 * uses it as is; the scaffold's `applyTrial` adds the `.gitignore` guard.
 */
export async function writeEnvKey(
  dir: string,
  apiKey: string,
  opts: { replace?: boolean } = {},
): Promise<TrialApplyResult> {
  const root = resolve(dir);
  const wrote: string[] = [];
  const skipped: string[] = [];

  const envPath = join(root, ".env");
  if (existsSync(envPath)) {
    const current = await readFile(envPath, "utf8");
    if (ENV_KEY_LINE.test(current)) {
      if (opts.replace) {
        await writeFile(envPath, current.replace(new RegExp(`^(\\s*(?:export\\s+)?${ENV_KEY}\\s*=).*$`, "gm"), `$1${apiKey}`));
        wrote.push(".env");
      } else {
        skipped.push(`.env already sets ${ENV_KEY} — left untouched; the new trial key was not written`);
      }
    } else {
      const lead = current === "" || current.endsWith("\n") ? "" : "\n";
      await appendFile(envPath, `${lead}${ENV_KEY}=${apiKey}\n`);
      wrote.push(".env");
    }
  } else {
    await writeFile(envPath, `${ENV_KEY}=${apiKey}\n`);
    wrote.push(".env");
  }
  return { wrote, skipped };
}

/** Guarantee `<dir>/.gitignore` lists `.env` and `.env.*` (appended when missing). Returns [".gitignore"] when it wrote. */
export async function ensureEnvIgnored(dir: string): Promise<string[]> {
  const ignorePath = join(resolve(dir), ".gitignore");
  const existing = existsSync(ignorePath) ? await readFile(ignorePath, "utf8") : "";
  const present = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const missing = IGNORE_LINES.filter((line) => !present.has(line));
  if (missing.length === 0) return [];
  const lead = existing === "" ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  await writeFile(ignorePath, `${existing}${lead}${missing.join("\n")}\n`);
  return [".gitignore"];
}

/**
 * Put a freshly minted trial key to work in `dir`: `.env` gets NOLA_API_KEY
 * (appended, never overwriting an existing entry), `.gitignore` is guaranteed
 * to list `.env` and `.env.*`, and — unless the project already has one
 * (`hasConfig`) — `nola.config.ts` becomes the trial config.
 */
export async function applyTrial(dir: string, init: { apiKey: string; hasConfig: boolean }): Promise<TrialApplyResult> {
  const root = resolve(dir);
  const { wrote, skipped } = await writeEnvKey(root, init.apiKey);
  wrote.push(...(await ensureEnvIgnored(root)));

  if (init.hasConfig) {
    skipped.push('nola.config.ts already exists — set `model: "nola"` to use the trial key');
  } else {
    await writeFile(join(root, "nola.config.ts"), await readFile(TRIAL_CONFIG_URL, "utf8"));
    wrote.push("nola.config.ts");
  }

  return { wrote, skipped };
}
