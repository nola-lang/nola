import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * `<home>/.nola/config.json` — per-machine state (spec
 * 2026-09-02-home-config-trial-identity-design.md). Holds identifiers and
 * dates ONLY, never a credential, and nothing in it is ever sent to the
 * server: the CLI reads it to tell the user about an earlier trial, and
 * records the account a successful trial granted. Every failure to read or
 * write answers softly (undefined / "skipped") so the scaffold is never
 * affected by the state of the home directory.
 */
export const HOME_CONFIG_FILE = "config.json";
const HOME_CONFIG_VERSION = 1;

export interface TrialAccountRecord {
  /** `account.id` from the trial response — a public identifier */
  accountId: string;
  /** client clock at the successful request, ISO 8601 — informational */
  issuedAt: string;
}

export interface NolaHomeConfig {
  version: 1;
  /** keyed by the API base URL the trial was requested from (no trailing slash) */
  accounts: Record<string, TrialAccountRecord>;
}

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function homeConfigPath(home: string = homedir()): string {
  return join(home, ".nola", HOME_CONFIG_FILE);
}

/**
 * The parsed object, or a reason it cannot be used: "absent" (create on
 * write), "corrupt" (unparsable or not an object — leave alone), "foreign"
 * (a version this build does not understand — leave alone).
 */
async function readRaw(home: string): Promise<{ raw: Raw } | { reason: "absent" | "corrupt" | "foreign" }> {
  let text: string;
  try {
    text = await readFile(homeConfigPath(home), "utf8");
  } catch {
    return { reason: "absent" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { reason: "corrupt" };
  }
  if (!isRecord(parsed)) return { reason: "corrupt" };
  if (parsed.version !== HOME_CONFIG_VERSION) return { reason: "foreign" };
  return { raw: parsed };
}

function accountsOf(raw: Raw): Record<string, TrialAccountRecord> {
  const out: Record<string, TrialAccountRecord> = {};
  if (!isRecord(raw.accounts)) return out;
  for (const [url, entry] of Object.entries(raw.accounts)) {
    if (isRecord(entry) && typeof entry.accountId === "string" && typeof entry.issuedAt === "string") {
      out[url] = { accountId: entry.accountId, issuedAt: entry.issuedAt };
    }
  }
  return out;
}

/** undefined when the file is absent, unparsable, or of an unknown version. Never throws. */
export async function readHomeConfig(home: string = homedir()): Promise<NolaHomeConfig | undefined> {
  const result = await readRaw(home);
  return "raw" in result ? { version: HOME_CONFIG_VERSION, accounts: accountsOf(result.raw) } : undefined;
}

/**
 * Read-modify-write of `accounts[apiUrl]`. Unknown top-level keys survive; a
 * corrupt or foreign-version file is left byte-identical and reported as
 * "skipped", as is an unwritable home. Never throws.
 */
export async function recordTrialAccount(
  home: string | undefined,
  apiUrl: string,
  record: TrialAccountRecord,
): Promise<"written" | "skipped"> {
  const dir = home ?? homedir();
  const result = await readRaw(dir);
  if ("reason" in result && result.reason !== "absent") return "skipped";
  const raw: Raw = "raw" in result ? result.raw : {};
  const accounts: Raw = isRecord(raw.accounts) ? { ...raw.accounts } : {};
  accounts[apiUrl] = { accountId: record.accountId, issuedAt: record.issuedAt };
  const next = { ...raw, version: HOME_CONFIG_VERSION, accounts };
  try {
    await mkdir(join(dir, ".nola"), { recursive: true });
    await writeFile(homeConfigPath(dir), `${JSON.stringify(next, null, 2)}\n`);
    return "written";
  } catch {
    return "skipped";
  }
}
