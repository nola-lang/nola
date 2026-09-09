import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NolaApiError } from "../src/api.js";
import { CREDENTIALS_FILE } from "../src/credentials.js";
import { HOME_CONFIG_FILE } from "../src/home-config.js";
import { acquireKey, claimNote, claimProjectKey, SignInRequiredError } from "../src/key.js";

const tmp = () => mkdtemp(join(tmpdir(), "nola-acquire-"));
const API = "https://api.nola.sh";
const KEY = `nola_sk_${"a".repeat(40)}`;
const KEY2 = `nola_sk_${"b".repeat(40)}`;
const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const AT = jwt({ sub: "auth0|1", "nola:account_id": "acct_u" });
const ID_TOKEN = `h.${Buffer.from(JSON.stringify({ email: "dev@example.com" })).toString("base64url")}.s`;
const CAPS = { protocol: 1, infer: true, ingest: false, auth: { issuer: API, clientId: "cli", audience: "aud", redirectPorts: [0] } };

type Reply = { status?: number; body?: unknown } | Error;
function stub(overrides: Record<string, Reply> = {}) {
  const calls: { path: string; authorization?: string; body?: unknown }[] = [];
  const fn = (async (url: unknown, init: unknown) => {
    const i = init as RequestInit;
    const headers = (i.headers ?? {}) as Record<string, string>;
    const path = new URL(String(url)).pathname;
    const raw = i.body ? String(i.body) : undefined;
    const body = raw === undefined ? undefined : headers["content-type"]?.includes("json") ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
    calls.push({ path, authorization: headers.authorization, body });
    const r = overrides[path];
    if (r instanceof Error) throw r;
    if (r) return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
    const defaults: Record<string, [number, unknown]> = {
      "/v1/trial": [201, { apiKey: KEY, account: { id: "acct_1", kind: "anonymous" }, trial: { runs: 25 } }],
      "/v1/capabilities": [200, CAPS],
      "/oauth/token": [200, { access_token: AT, refresh_token: "rt", expires_in: 3600, id_token: ID_TOKEN }],
      "/v1/console/keys": [201, { id: "key_2", name: "cli", prefix: "nola_sk_bb", suffix: "bbbbbbbb", apiKey: KEY2 }],
      "/v1/billing/session": [201, { url: "https://platform.nola.sh/billing?session=bill_1", expiresAt: "2099-01-01T00:00:00.000Z" }],
      "/v1/console/sessions/bill_1/claim": [200, { outcome: "merged", accountId: "acct_u" }],
    };
    const d = defaults[path] ?? [404, { error: { code: "not_found", message: path } }];
    return new Response(JSON.stringify(d[1]), { status: d[0] });
  }) as typeof globalThis.fetch;
  return { fn, calls };
}

async function seedSession(home: string) {
  await mkdir(join(home, ".nola"), { recursive: true });
  await writeFile(
    join(home, ".nola", CREDENTIALS_FILE),
    JSON.stringify({ version: 1, sessions: { [API]: { accessToken: AT, refreshToken: "rt", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), email: "dev@example.com" } } }),
  );
}
async function seedConfig(home: string) {
  await mkdir(join(home, ".nola"), { recursive: true });
  await writeFile(join(home, ".nola", HOME_CONFIG_FILE), JSON.stringify({ version: 1, accounts: { [API]: { accountId: "acct_old", issuedAt: "2026-09-01T08:00:00.000Z" } } }));
}
/** A stand-in browser: comes straight back to the CLI's loopback callback with a code and the right state. */
function approvingBrowser(opened: string[] = []) {
  return (url: string) => {
    opened.push(url);
    const u = new URL(url);
    void globalThis.fetch(`${u.searchParams.get("redirect_uri")}?code=ac&state=${u.searchParams.get("state")}`).catch(() => undefined);
    return true;
  };
}
const base = (home: string, fn: typeof globalThis.fetch, interactive: boolean, notes: string[] = []) => ({
  home,
  apiUrl: API,
  fetch: fn,
  interactive,
  note: (m: string) => void notes.push(m),
  open: approvingBrowser(),
});

describe("acquireKey", () => {
  it("fresh machine: the anonymous trial, recorded in config.json, no credentials file", async () => {
    const home = await tmp();
    const { fn, calls } = stub();
    const grant = await acquireKey(base(home, fn, false));
    expect(grant).toEqual({ apiKey: KEY, source: "trial", runs: 25, accountId: "acct_1" });
    expect(calls.map((c) => c.path)).toEqual(["/v1/trial"]);
    expect(JSON.parse(await readFile(join(home, ".nola", HOME_CONFIG_FILE), "utf8")).accounts[API].accountId).toBe("acct_1");
  });

  it("signed in: a console key with the access token; a 401 forgets the session and falls through", async () => {
    const home = await tmp();
    await seedSession(home);
    const { fn, calls } = stub();
    expect(await acquireKey(base(home, fn, false))).toEqual({ apiKey: KEY2, source: "account" });
    expect(calls).toEqual([{ path: "/v1/console/keys", authorization: `Bearer ${AT}`, body: { name: "cli" } }]);

    const home2 = await tmp();
    await seedSession(home2);
    await seedConfig(home2);
    const rejected = stub({ "/v1/console/keys": { status: 401, body: { error: { code: "unauthorized", message: "Your session is not valid." } } } });
    const err = await acquireKey(base(home2, rejected.fn, false)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SignInRequiredError);
    expect((err as Error).message).toBe(
      "This machine already used its 25 free Nola runs. Sign in with `npx nola-lang login` to get an API key for this project.",
    );
    expect(JSON.parse(await readFile(join(home2, ".nola", CREDENTIALS_FILE), "utf8")).sessions).toEqual({});

    // account-claim-required: a 403 naming a missing or stale account claim is the same "session is dead" signal; other 403s are not
    for (const code of ["account_claim_missing", "account_mismatch"]) {
      const home3 = await tmp();
      await seedSession(home3);
      await seedConfig(home3);
      const stale = stub({ "/v1/console/keys": { status: 403, body: { error: { code, message: "Sign in again." } } } });
      await expect(acquireKey(base(home3, stale.fn, false))).rejects.toBeInstanceOf(SignInRequiredError);
      expect(JSON.parse(await readFile(join(home3, ".nola", CREDENTIALS_FILE), "utf8")).sessions).toEqual({});
    }
    const home4 = await tmp();
    await seedSession(home4);
    const forbidden = stub({ "/v1/console/keys": { status: 403, body: { error: { code: "forbidden", message: "This Nola account is suspended." } } } });
    const other = (await acquireKey(base(home4, forbidden.fn, false)).catch((e: unknown) => e)) as NolaApiError;
    expect(other).toBeInstanceOf(NolaApiError);
    expect(other.status).toBe(403);
    expect(JSON.parse(await readFile(join(home4, ".nola", CREDENTIALS_FILE), "utf8")).sessions[API]).toBeDefined();
  });

  it("used machine, not signed in: non-interactive throws SignInRequiredError with NO request; interactive signs in and mints", async () => {
    const home = await tmp();
    await seedConfig(home);
    const idle = stub();
    await expect(acquireKey(base(home, idle.fn, false))).rejects.toBeInstanceOf(SignInRequiredError);
    expect(idle.calls).toEqual([]);

    const notes: string[] = [];
    const { fn, calls } = stub();
    expect(await acquireKey(base(home, fn, true, notes))).toEqual({ apiKey: KEY2, source: "account" });
    expect(calls.map((c) => c.path)).toEqual(["/v1/capabilities", "/oauth/token", "/v1/console/keys"]);
    expect(calls[1]?.body).toMatchObject({ grant_type: "authorization_code", client_id: "cli", code: "ac" });
    expect(calls[2]?.authorization).toBe(`Bearer ${AT}`);
    expect(notes.at(-1)).toBe("Signed in as dev@example.com.");
    expect(JSON.parse(await readFile(join(home, ".nola", CREDENTIALS_FILE), "utf8")).sessions[API].accessToken).toBe(AT);
  });

  it("used machine, interactive: confirmSignIn is asked BEFORE the browser; yes signs in, no/Esc = SignInRequiredError with no request", async () => {
    const opened: string[] = [];
    const asked: number[] = [];
    // each answer on its own used machine: a successful sign-in stores a session, which would short-circuit the next run
    const withHook = async (fn: typeof globalThis.fetch, answer: boolean | null) => {
      const home = await tmp();
      await seedConfig(home);
      return {
        ...base(home, fn, true),
        open: approvingBrowser(opened),
        confirmSignIn: async () => {
          asked.push(opened.length);
          return answer;
        },
      };
    };
    for (const answer of [false, null]) {
      const idle = stub();
      await expect(acquireKey(await withHook(idle.fn, answer))).rejects.toBeInstanceOf(SignInRequiredError);
      expect(idle.calls).toEqual([]);
    }
    expect(opened).toEqual([]); // declining never opened the browser

    const yes = stub();
    expect(await acquireKey(await withHook(yes.fn, true))).toEqual({ apiKey: KEY2, source: "account" });
    expect(asked).toEqual([0, 0, 0]); // always asked while nothing had been opened yet
    expect(opened).toHaveLength(1);
  });

  it("propagates API failures untouched (the caller decides between a note and exit 1)", async () => {
    const home = await tmp();
    await seedSession(home);
    const { fn } = stub({ "/v1/console/keys": { status: 409, body: { error: { code: "key_limit", message: "10 live keys already." } } } });
    const err = (await acquireKey(base(home, fn, false)).catch((e: unknown) => e)) as NolaApiError;
    expect(err).toBeInstanceOf(NolaApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe("10 live keys already.");
  });
});

describe("claimProjectKey", () => {
  it("nothing to claim without a project key; otherwise session → claim, outcome noted; failures are reported, not thrown", async () => {
    const dir = await tmp();
    expect(await claimProjectKey(dir, AT, { apiUrl: API, fetch: stub().fn })).toBeUndefined();
    await writeFile(join(dir, ".env"), `NOLA_API_KEY=${KEY}\n`);
    const { fn, calls } = stub();
    const result = await claimProjectKey(dir, AT, { apiUrl: API, fetch: fn });
    expect(result).toEqual({ outcome: "merged" });
    expect(calls).toEqual([
      { path: "/v1/billing/session", authorization: `Bearer ${KEY}`, body: {} },
      { path: "/v1/console/sessions/bill_1/claim", authorization: `Bearer ${AT}`, body: {} },
    ]);
    expect(claimNote({ outcome: "merged" })).toBe("Merged this project's trial account into your Nola account.");
    expect(claimNote({ outcome: "claimed" })).toBe("Linked this project's trial account to your Nola account.");
    expect(claimNote({ outcome: "already_owned" })).toBe("This project's account is already yours.");
    const failing = stub({ "/v1/billing/session": { status: 401, body: { error: { code: "unauthorized", message: "bad key" } } } });
    const failed = await claimProjectKey(dir, AT, { apiUrl: API, fetch: failing.fn });
    expect(failed).toEqual({ error: "bad key" });
    expect(claimNote(failed as { error: string })).toContain("Could not link this project's trial account");
  });
});
