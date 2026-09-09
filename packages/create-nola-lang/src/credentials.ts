import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * `<home>/.nola/credentials.json` — the signed-in user's Auth0 session per
 * API URL (spec 2026-09-04-cli-sign-in-design.md §2). Created ONLY by a
 * successful `nola login` (or the sign-in step of `nola init` / `nola key`),
 * owner-only (0600). The tokens are NEVER logged, noted, or sent anywhere but
 * the Nola API's and the Auth0 tenant's Authorization/token endpoints.
 * `config.json` next to it stays credential-free (spec 2026-09-02). A file
 * of a version this build does not understand is left alone, like
 * `config.json`. Every failure answers softly (undefined / "skipped") so no
 * command depends on the home directory.
 */
export const CREDENTIALS_FILE = "credentials.json";
const CREDENTIALS_VERSION = 1;

export interface Session {
  /** the Auth0 access token for the platform audience (short-lived) */
  accessToken: string;
  /** the Auth0 rotating refresh token */
  refreshToken: string;
  /** access-token expiry, ISO 8601 */
  expiresAt: string;
  /** display only — from the id token, unverified; never proof */
  email: string | null;
}

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function credentialsPath(home: string = homedir()): string {
  return join(home, ".nola", CREDENTIALS_FILE);
}

/** "unusable" = unparsable or of a version this build does not understand — left byte-identical, never overwritten. */
async function readRaw(home: string): Promise<{ raw: Raw } | { reason: "absent" | "unusable" }> {
  let text: string;
  try {
    text = await readFile(credentialsPath(home), "utf8");
  } catch {
    return { reason: "absent" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { reason: "unusable" };
  }
  if (!isRecord(parsed)) return { reason: "unusable" };
  if (parsed.version !== CREDENTIALS_VERSION) return { reason: "unusable" };
  return { raw: parsed };
}

function sessionOf(entry: unknown): Session | undefined {
  if (!isRecord(entry)) return undefined;
  const { accessToken, refreshToken, expiresAt, email } = entry;
  if (typeof accessToken !== "string" || accessToken === "") return undefined;
  if (typeof refreshToken !== "string" || refreshToken === "") return undefined;
  if (typeof expiresAt !== "string") return undefined;
  return { accessToken, refreshToken, expiresAt, email: typeof email === "string" ? email : null };
}

/** undefined when the file is absent, unparsable, of an unknown version, or has no well-formed session for `apiUrl`. Never throws. */
export async function readSession(home: string | undefined, apiUrl: string): Promise<Session | undefined> {
  const result = await readRaw(home ?? homedir());
  if (!("raw" in result) || !isRecord(result.raw.sessions)) return undefined;
  return sessionOf(result.raw.sessions[apiUrl]);
}

async function rewrite(home: string, mutate: (sessions: Raw) => void): Promise<"written" | "skipped"> {
  const result = await readRaw(home);
  if ("reason" in result && result.reason === "unusable") return "skipped";
  const raw: Raw = "raw" in result ? result.raw : {};
  const sessions: Raw = isRecord(raw.sessions) ? { ...raw.sessions } : {};
  mutate(sessions);
  const next = { ...raw, version: CREDENTIALS_VERSION, sessions };
  try {
    await mkdir(join(home, ".nola"), { recursive: true });
    // `mode` applies on creation; the file only ever comes into being here, so it is always 0600.
    await writeFile(credentialsPath(home), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    return "written";
  } catch {
    return "skipped";
  }
}

/** Read-modify-write of `sessions[apiUrl]`, owner-only. Unknown top-level keys survive; an unparsable or unknown-version file is left byte-identical ("skipped"). Never throws. */
export async function writeSession(home: string | undefined, apiUrl: string, session: Session): Promise<"written" | "skipped"> {
  return rewrite(home ?? homedir(), (sessions) => {
    sessions[apiUrl] = { ...session };
  });
}

/** Drops `sessions[apiUrl]`. Idempotent — an absent entry or file is still "written". Never throws. */
export async function deleteSession(home: string | undefined, apiUrl: string): Promise<"written" | "skipped"> {
  const dir = home ?? homedir();
  const result = await readRaw(dir);
  if ("reason" in result && result.reason === "absent") return "written";
  return rewrite(dir, (sessions) => {
    delete sessions[apiUrl];
  });
}
