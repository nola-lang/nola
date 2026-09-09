import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cmdLogin, cmdLogout } from "../src/login.js";

const tmp = () => mkdtemp(join(tmpdir(), "nola-login-"));
const BASE = "https://api.nola.sh";
const KEY = `nola_sk_${"a".repeat(40)}`;
const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const AT = jwt({ sub: "auth0|1", "nola:account_id": "acct_u" });
const ID_TOKEN = `h.${Buffer.from(JSON.stringify({ email: "dev@example.com" })).toString("base64url")}.s`;
const CAPS = { protocol: 1, infer: true, ingest: false, auth: { issuer: BASE, clientId: "cli", audience: "aud", redirectPorts: [0] }, consoleUrl: "https://platform.nola.sh" };

type Reply = { status?: number; body?: unknown } | Error;
export function stub(overrides: Record<string, Reply> = {}) {
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
      "/v1/capabilities": [200, CAPS],
      "/oauth/token": [200, { access_token: AT, refresh_token: "rt", expires_in: 3600, id_token: ID_TOKEN }],
      "/oauth/revoke": [200, {}],
      "/v1/billing/session": [201, { url: "https://platform.nola.sh/billing?session=bill_1", expiresAt: "2099-01-01T00:00:00.000Z" }],
      "/v1/console/sessions/bill_1/claim": [200, { outcome: "claimed", accountId: "acct_u" }],
      "/v1/console/me": [
        200,
        {
          user: { id: "usr_1", email: "dev@example.com", name: null, avatarUrl: null },
          account: { id: "acct_u", kind: "user", status: "active", mode: "trial", trial: { runsUsed: 3, runsLimit: 25 }, balanceMicro: 7_840_000, spendThisMonthMicro: 0, liveKeyCount: 2 },
        },
      ],
    };
    const d = defaults[path] ?? [404, { error: { code: "not_found", message: path } }];
    return new Response(JSON.stringify(d[1]), { status: d[0] });
  }) as typeof globalThis.fetch;
  return { fn, calls };
}

/** A stand-in browser: comes straight back to the CLI's loopback callback with a code and the right state. */
export function approvingBrowser(opened: string[] = []) {
  return browserAnswering(opened, (u) => `code=ac&state=${u.searchParams.get("state")}`);
}
/** A stand-in browser whose user pressed "decline" on the tenant's consent page. */
export function decliningBrowser(opened: string[] = []) {
  return browserAnswering(opened, (u) => `error=access_denied&state=${u.searchParams.get("state")}`);
}
function browserAnswering(opened: string[], query: (u: URL) => string) {
  return (url: string) => {
    opened.push(url);
    const u = new URL(url);
    void globalThis.fetch(`${u.searchParams.get("redirect_uri")}?${query(u)}`).catch(() => undefined);
    return true;
  };
}

function io(home: string) {
  const out: string[] = [];
  const err: string[] = [];
  const opened: string[] = [];
  return {
    out,
    err,
    opened,
    opts: {
      baseUrl: BASE,
      home,
      out: (l: string) => out.push(l),
      err: (l: string) => err.push(l),
      open: approvingBrowser(opened),
    },
  };
}
const sessionsOf = async (home: string) => JSON.parse(await readFile(join(home, ".nola", "credentials.json"), "utf8")).sessions;

describe("nola login / logout", () => {
  it("login: PKCE with the authorize URL noted and opened, session stored, exit 0; no project key → no claim", async () => {
    const home = await tmp();
    const { fn, calls } = stub();
    const { out, err, opened, opts } = io(home);
    expect(await cmdLogin({ ...opts, cwd: await tmp(), fetch: fn })).toBe(0);
    expect(calls.map((c) => c.path)).toEqual(["/v1/capabilities", "/oauth/token"]);
    expect(opened).toEqual([expect.stringMatching(/^https:\/\/api\.nola\.sh\/authorize\?/)]);
    expect(out).toEqual([`Sign in to Nola: open ${opened[0]}`, "Waiting for the browser…", "Signed in as dev@example.com."]);
    expect(err).toEqual([]);
    expect((await sessionsOf(home))[BASE]).toMatchObject({ accessToken: AT, refreshToken: "rt", email: "dev@example.com" });
  });

  it("login inside a project with a key claims that account and says so", async () => {
    const home = await tmp();
    const cwd = await tmp();
    await writeFile(join(cwd, ".env"), `NOLA_API_KEY=${KEY}\n`);
    const { fn, calls } = stub();
    const { out, opts } = io(home);
    expect(await cmdLogin({ ...opts, cwd, fetch: fn })).toBe(0);
    expect(calls.slice(2)).toEqual([
      { path: "/v1/billing/session", authorization: `Bearer ${KEY}`, body: {} },
      { path: "/v1/console/sessions/bill_1/claim", authorization: `Bearer ${AT}`, body: {} },
    ]);
    expect(out.at(-1)).toBe("Linked this project's trial account to your Nola account.");
    // a failed claim is one note, not an exit code
    const home2 = await tmp();
    const failing = stub({ "/v1/billing/session": { status: 401, body: { error: { code: "unauthorized", message: "bad key" } } } });
    const second = io(home2);
    expect(await cmdLogin({ ...second.opts, cwd, fetch: failing.fn })).toBe(0);
    expect(second.out.at(-1)).toBe("Could not link this project's trial account to your Nola account: bad key");
  });

  it("login: exit 1 with the provider's message when sign-in is unavailable or declined; nothing stored", async () => {
    const home = await tmp();
    const none = stub({ "/v1/capabilities": { body: { protocol: 1, ingest: false } } });
    const a = io(home);
    expect(await cmdLogin({ ...a.opts, cwd: await tmp(), fetch: none.fn })).toBe(1);
    expect(a.err).toEqual(["Sign-in is not available on this Nola server yet."]);
    const denied = stub();
    const b = io(home);
    expect(await cmdLogin({ ...b.opts, cwd: await tmp(), fetch: denied.fn, open: decliningBrowser() })).toBe(1);
    expect(b.err).toEqual(["Sign-in was declined in the browser."]);
    const offline = stub({ "/v1/capabilities": new Error("ENOTFOUND") });
    const c = io(home);
    expect(await cmdLogin({ ...c.opts, cwd: await tmp(), fetch: offline.fn })).toBe(1);
    expect(c.err[0]).toMatch(/^Could not sign in: Could not reach the Nola API/);
  });

  it("logout revokes and forgets; a second logout says not signed in", async () => {
    const home = await tmp();
    await mkdir(join(home, ".nola"), { recursive: true });
    await writeFile(
      join(home, ".nola", "credentials.json"),
      JSON.stringify({ version: 1, sessions: { [BASE]: { accessToken: AT, refreshToken: "rt", expiresAt: "2099-01-01T00:00:00.000Z", email: null } } }),
    );
    const { fn, calls } = stub();
    const a = io(home);
    expect(await cmdLogout({ ...a.opts, fetch: fn })).toBe(0);
    expect(a.out).toEqual(["Signed out of Nola."]);
    expect(calls.at(-1)).toEqual({ path: "/oauth/revoke", authorization: undefined, body: { client_id: "cli", token: "rt" } });
    expect((await sessionsOf(home))[BASE]).toBeUndefined();
    const b = io(home);
    expect(await cmdLogout({ ...b.opts, fetch: fn })).toBe(0);
    expect(b.out).toEqual(["Not signed in."]);
  });
});
