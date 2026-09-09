import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { accessTokenFor, authConfig, authorizeUrl, emailFromIdToken, pkcePair, SignInError, SignInUnavailableError, signIn, signOut } from "../src/auth.js";
import { CREDENTIALS_FILE, deleteSession, writeSession } from "../src/credentials.js";
import { recordTrialAccount } from "../src/home-config.js";

const tmp = () => mkdtemp(join(tmpdir(), "nola-auth-"));
const API = "https://api.nola.sh";
const AUTH = { issuer: "https://tenant.auth0.com", clientId: "cli", audience: "aud", redirectPorts: [0] };
const ID_TOKEN = `h.${Buffer.from(JSON.stringify({ sub: "auth0|1", email: "dev@example.com" })).toString("base64url")}.s`;
const ACCESS = `h.${Buffer.from(JSON.stringify({ sub: "auth0|1", "nola:account_id": "acct_u" })).toString("base64url")}.sekret`;
const TOKENS = { access_token: ACCESS, refresh_token: "sekret-refresh", expires_in: 3600, id_token: ID_TOKEN };

type Reply = { status?: number; body?: unknown } | Error;
function stub(routes: Record<string, Reply | Reply[]>) {
  const calls: { url: string; body: Record<string, string> | unknown; auth?: string }[] = [];
  const fn = (async (url: unknown, init: unknown) => {
    const i = init as RequestInit;
    const headers = (i.headers ?? {}) as Record<string, string>;
    const raw = i.body ? String(i.body) : "";
    const body = headers["content-type"]?.includes("json") ? JSON.parse(raw || "{}") : Object.fromEntries(new URLSearchParams(raw));
    calls.push({ url: String(url), body, auth: headers.authorization });
    const key = new URL(String(url)).pathname;
    const entry = routes[key];
    const r = Array.isArray(entry) ? (entry.length > 1 ? entry.shift() : entry[0]) : entry;
    if (r === undefined) return new Response(JSON.stringify({ error: { code: "not_found", message: key } }), { status: 404 });
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  }) as typeof globalThis.fetch;
  return { fn, calls };
}
const sessionsOf = async (home: string) => JSON.parse(await readFile(join(home, ".nola", CREDENTIALS_FILE), "utf8")).sessions;

const approve = (u: URL) => `code=ac&state=${u.searchParams.get("state")}`;

/**
 * A stand-in browser: `open` receives the authorize URL and "comes back" to the
 * loopback callback the way the tenant's 302 would. `reply` builds the callback
 * query from the authorize URL; the real global fetch hits the CLI's listener.
 */
function browser(reply: (u: URL) => string = approve) {
  const opened: URL[] = [];
  const responses: { status: number; text: string }[] = [];
  const pending: Promise<unknown>[] = [];
  const open = (url: string) => {
    const u = new URL(url);
    opened.push(u);
    pending.push(
      globalThis
        .fetch(`${u.searchParams.get("redirect_uri")}?${reply(u)}`)
        .then(async (r) => responses.push({ status: r.status, text: await r.text() }))
        .catch(() => undefined),
    );
    return true;
  };
  /** the pages the tab received, once every fetch it started has settled */
  const settled = async () => {
    await Promise.all(pending);
    return responses;
  };
  return { open, opened, settled };
}

describe("PKCE helpers", () => {
  it("pkcePair: a base64url verifier of 43+ chars whose S256 hash is the challenge", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(pkcePair().verifier).not.toBe(verifier);
  });

  it("authorizeUrl carries every OAuth parameter and the trial hint only when given", () => {
    const u = new URL(authorizeUrl(AUTH, { redirectUri: "http://127.0.0.1:47831/callback", challenge: "ch", state: "st", accountId: "acct_1" }));
    expect(`${u.origin}${u.pathname}`).toBe("https://tenant.auth0.com/authorize");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: "code",
      client_id: "cli",
      redirect_uri: "http://127.0.0.1:47831/callback",
      scope: "openid profile email offline_access",
      audience: "aud",
      code_challenge: "ch",
      code_challenge_method: "S256",
      state: "st",
      "ext-nola_account": "acct_1",
    });
    const bare = new URL(authorizeUrl(AUTH, { redirectUri: "http://127.0.0.1:47831/callback", challenge: "ch", state: "st" }));
    expect(bare.searchParams.has("ext-nola_account")).toBe(false);
  });

  it("emailFromIdToken reads the payload's email claim without verifying; junk → null", () => {
    expect(emailFromIdToken(ID_TOKEN)).toBe("dev@example.com");
    expect(emailFromIdToken(undefined)).toBeNull();
    expect(emailFromIdToken("not-a-jwt")).toBeNull();
    expect(emailFromIdToken("a.b.c")).toBeNull();
  });
});

describe("signIn / accessTokenFor / signOut", () => {
  it("signIn: discovers the tenant, opens /authorize with the trial hint, takes one callback, exchanges the code with the verifier, stores the session", async () => {
    const home = await tmp();
    await recordTrialAccount(home, API, { accountId: "acct_trial", issuedAt: "2026-09-01T00:00:00.000Z" });
    const { fn, calls } = stub({ "/v1/capabilities": { body: { protocol: 1, ingest: false, auth: AUTH } }, "/oauth/token": { body: TOKENS } });
    const notes: string[] = [];
    const b = browser();
    const session = await signIn({ home, apiUrl: API, fetch: fn, note: (m) => notes.push(m), open: b.open });
    expect(calls.map((c) => c.url)).toEqual([`${API}/v1/capabilities`, "https://tenant.auth0.com/oauth/token"]);
    const authorize = b.opened[0] as URL;
    expect(`${authorize.origin}${authorize.pathname}`).toBe("https://tenant.auth0.com/authorize");
    expect(authorize.searchParams.get("ext-nola_account")).toBe("acct_trial");
    expect(authorize.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    const exchange = calls[1]?.body as Record<string, string>;
    expect(exchange).toMatchObject({ grant_type: "authorization_code", client_id: "cli", code: "ac", redirect_uri: authorize.searchParams.get("redirect_uri") });
    expect(createHash("sha256").update(exchange.code_verifier as string).digest("base64url")).toBe(authorize.searchParams.get("code_challenge"));
    expect(notes).toEqual([`Sign in to Nola: open ${authorize.href}`, "Waiting for the browser…", "Signed in as dev@example.com."]);
    expect(session).toEqual({ accessToken: ACCESS, refreshToken: "sekret-refresh", expiresAt: expect.stringMatching(/Z$/), email: "dev@example.com" });
    expect((await sessionsOf(home))[API]).toEqual(session);
    expect(notes.join("\n")).not.toContain("sekret");
    expect(await b.settled()).toEqual([{ status: 200, text: expect.stringContaining("Signed in to Nola") }]);
  });

  it("signIn: no trial recorded → no hint; a server without auth or without redirect ports → SignInUnavailableError", async () => {
    const home = await tmp();
    const { fn } = stub({ "/v1/capabilities": { body: { protocol: 1, ingest: false, auth: AUTH } }, "/oauth/token": { body: TOKENS } });
    const b = browser();
    await signIn({ home, apiUrl: API, fetch: fn, note: () => {}, open: b.open });
    expect((b.opened[0] as URL).searchParams.has("ext-nola_account")).toBe(false);
    const withoutPorts = { issuer: AUTH.issuer, clientId: "cli", audience: "aud" };
    for (const caps of [{ protocol: 1, ingest: false }, { protocol: 1, ingest: false, auth: withoutPorts }, { protocol: 1, ingest: false, auth: { ...AUTH, redirectPorts: [] } }]) {
      const none = stub({ "/v1/capabilities": { body: caps } });
      await expect(signIn({ home, apiUrl: API, fetch: none.fn, note: () => {}, open: () => true })).rejects.toBeInstanceOf(SignInUnavailableError);
    }
  });

  it("signIn: declined, wrong state, timeout, no refresh token, no account claim, busy ports", async () => {
    const home = await tmp();
    await writeSession(home, API, { accessToken: "stale", refreshToken: "rt", expiresAt: "2099-01-01T00:00:00.000Z", email: null });
    await deleteSession(home, API);
    const caps = { "/v1/capabilities": { body: { protocol: 1, ingest: false, auth: AUTH } } };
    const declined = browser((u) => `error=access_denied&error_description=denied&state=${u.searchParams.get("state")}`);
    await expect(signIn({ home, apiUrl: API, fetch: stub(caps).fn, note: () => {}, open: declined.open })).rejects.toThrow("Sign-in was declined in the browser.");
    const wrongState = browser(() => "code=ac&state=nope");
    const mismatch = await signIn({ home, apiUrl: API, fetch: stub(caps).fn, note: () => {}, open: wrongState.open }).catch((e: unknown) => e);
    expect(mismatch).toBeInstanceOf(SignInError);
    expect((mismatch as Error).message).toMatch(/unexpected state/);
    expect((await wrongState.settled())[0]?.status).toBe(400);
    await expect(signIn({ home, apiUrl: API, fetch: stub(caps).fn, note: () => {}, open: () => true, timeoutMs: 30 })).rejects.toThrow(/timed out/);
    const noRefresh = stub({ ...caps, "/oauth/token": { body: { access_token: "at", expires_in: 3600 } } });
    await expect(signIn({ home, apiUrl: API, fetch: noRefresh.fn, note: () => {}, open: browser().open })).rejects.toThrow(/offline_access/);
    // account-claim-required: a token the tenant's Action did not stamp is refused before anything is stored
    const noClaim = stub({ ...caps, "/oauth/token": { body: { ...TOKENS, access_token: `h.${Buffer.from(JSON.stringify({ sub: "auth0|1" })).toString("base64url")}.s` } } });
    await expect(signIn({ home, apiUrl: API, fetch: noClaim.fn, note: () => {}, open: browser().open })).rejects.toThrow(/did not return your Nola account/);
    const opaque = stub({ ...caps, "/oauth/token": { body: { ...TOKENS, access_token: "not-a-jwt" } } });
    await expect(signIn({ home, apiUrl: API, fetch: opaque.fn, note: () => {}, open: browser().open })).rejects.toThrow(/did not return your Nola account/);
    expect((await sessionsOf(home))[API]).toBeUndefined();
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", r));
    const port = (blocker.address() as { port: number }).port;
    const busy = stub({ "/v1/capabilities": { body: { protocol: 1, ingest: false, auth: { ...AUTH, redirectPorts: [port] } } } });
    await expect(signIn({ home, apiUrl: API, fetch: busy.fn, note: () => {}, open: () => true })).rejects.toThrow(`Sign-in could not start: ports ${port} on 127.0.0.1 are in use.`);
    await new Promise<void>((r) => blocker.close(() => r()));
  });

  it("accessTokenFor returns the stored token while fresh, refreshes (and re-stores the rotated pair) near expiry, forgets a refused session", async () => {
    const home = await tmp();
    const fresh = { accessToken: "at", refreshToken: "rt", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), email: "dev@example.com" };
    await writeSession(home, API, fresh);
    const idle = stub({});
    expect(await accessTokenFor({ home, apiUrl: API, fetch: idle.fn })).toEqual({ token: "at", session: fresh });
    expect(idle.calls).toEqual([]);

    await writeSession(home, API, { ...fresh, expiresAt: new Date(Date.now() + 10_000).toISOString() });
    const refreshing = stub({
      "/v1/capabilities": { body: { protocol: 1, ingest: false, auth: AUTH } },
      "/oauth/token": { body: { access_token: "at2", refresh_token: "rt2", expires_in: 3600 } },
    });
    const got = await accessTokenFor({ home, apiUrl: API, fetch: refreshing.fn });
    expect(got?.token).toBe("at2");
    expect(refreshing.calls[1]?.body).toEqual({ grant_type: "refresh_token", client_id: "cli", refresh_token: "rt" });
    expect((await sessionsOf(home))[API]).toMatchObject({ accessToken: "at2", refreshToken: "rt2", email: "dev@example.com" });

    await writeSession(home, API, { ...fresh, expiresAt: new Date(Date.now() - 1).toISOString() });
    const refused = stub({
      "/v1/capabilities": { body: { protocol: 1, ingest: false, auth: AUTH } },
      "/oauth/token": { status: 403, body: { error: "invalid_grant", error_description: "Unknown or invalid refresh token." } },
    });
    expect(await accessTokenFor({ home, apiUrl: API, fetch: refused.fn })).toBeUndefined();
    expect((await sessionsOf(home))[API]).toBeUndefined();
    expect(await accessTokenFor({ home: await tmp(), apiUrl: API, fetch: idle.fn })).toBeUndefined();
  });

  it("signOut revokes best-effort and deletes; not signed in is reported", async () => {
    const home = await tmp();
    await writeSession(home, API, { accessToken: "at", refreshToken: "rt", expiresAt: "2099-01-01T00:00:00.000Z", email: null });
    const { fn, calls } = stub({ "/v1/capabilities": { body: { protocol: 1, ingest: false, auth: AUTH } }, "/oauth/revoke": { body: {} } });
    expect(await signOut({ home, apiUrl: API, fetch: fn })).toBe("signed-out");
    expect(calls.at(-1)?.url).toBe("https://tenant.auth0.com/oauth/revoke");
    expect(calls.at(-1)?.body).toEqual({ client_id: "cli", token: "rt" });
    expect((await sessionsOf(home))[API]).toBeUndefined();
    expect(await signOut({ home, apiUrl: API, fetch: fn })).toBe("not-signed-in");
    // an unreachable tenant still forgets the session
    await writeSession(home, API, { accessToken: "at", refreshToken: "rt", expiresAt: "2099-01-01T00:00:00.000Z", email: null });
    expect(await signOut({ home, apiUrl: API, fetch: stub({ "/v1/capabilities": new Error("ENOTFOUND") }).fn })).toBe("signed-out");
    expect((await sessionsOf(home))[API]).toBeUndefined();
  });

  it("authConfig normalises the issuer, keeps only sane ports, and reports consoleUrl", async () => {
    const { fn } = stub({
      "/v1/capabilities": {
        body: { protocol: 1, ingest: false, auth: { ...AUTH, issuer: "https://tenant.auth0.com/", redirectPorts: [47831, -1, 70000, 1.5, 0] }, consoleUrl: "https://platform.nola.sh" },
      },
    });
    expect(await authConfig({ apiUrl: API, fetch: fn })).toEqual({ auth: { ...AUTH, redirectPorts: [47831, 0] }, consoleUrl: "https://platform.nola.sh" });
  });
});
