import { describe, expect, it } from "vitest";
import {
  claimSession,
  createBillingSession,
  createConsoleKey,
  fetchCapabilities,
  fetchMe,
  NolaApiError,
  nolaApiUrl,
  requestTrial,
  sessionIdOf,
} from "../src/api.js";

type Call = { url: string; init: RequestInit };

function fakeFetch(reply: (call: Call) => { status?: number; body?: unknown; headers?: Record<string, string> } | Error) {
  const calls: Call[] = [];
  const fn = (async (url: unknown, init: unknown) => {
    const call = { url: String(url), init: init as RequestInit };
    calls.push(call);
    const r = reply(call);
    if (r instanceof Error) throw r;
    const { status = 200, body, headers } = r;
    return new Response(body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  }) as typeof globalThis.fetch;
  return { fn, calls };
}

const KEY = `nola_sk_${"a".repeat(40)}`;
const AT = "at.access.token";

describe("nolaApiUrl", () => {
  it("defaults to the hosted API and honours NOLA_API_URL without a trailing slash", () => {
    expect(nolaApiUrl({})).toBe("https://api.nola.sh");
    expect(nolaApiUrl({ NOLA_API_URL: "http://127.0.0.1:8787/" })).toBe("http://127.0.0.1:8787");
    expect(nolaApiUrl({ NOLA_API_URL: "" })).toBe("https://api.nola.sh");
  });
});

describe("requestTrial", () => {
  it("POSTs /v1/trial with an EMPTY body and a user-agent, returns the trial grant", async () => {
    const { fn, calls } = fakeFetch(() => ({
      status: 201,
      body: { apiKey: KEY, account: { id: "acct_1", kind: "anonymous" }, trial: { runs: 25 } },
    }));
    const grant = await requestTrial({ fetch: fn, baseUrl: "http://x" });
    expect(grant).toEqual({ apiKey: KEY, source: "trial", runs: 25, accountId: "acct_1" });
    expect(calls[0]?.url).toBe("http://x/v1/trial");
    expect(calls[0]?.init.method).toBe("POST");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["user-agent"]).toMatch(/^create-nola-lang\/\d/);
    expect(headers.authorization).toBeUndefined();
    // Nothing on this machine identifies it to the server (spec 2026-09-02 §6.1).
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({});
  });

  it("turns a coded error into NolaApiError with the message verbatim, status, code and Retry-After", async () => {
    const { fn } = fakeFetch(() => ({
      status: 429,
      body: { error: { code: "rate_limited", message: "Too many trial sign-ups from this address." } },
      headers: { "retry-after": "60" },
    }));
    const err = (await requestTrial({ fetch: fn }).catch((e: unknown) => e)) as NolaApiError;
    expect(err).toBeInstanceOf(NolaApiError);
    expect(err.message).toBe("Too many trial sign-ups from this address.");
    expect(err.status).toBe(429);
    expect(err.code).toBe("rate_limited");
    expect(err.retryAfterMs).toBe(60_000);
  });

  it("wraps a thrown fetch (offline) as a status-0 NolaApiError naming the URL", async () => {
    const { fn } = fakeFetch(() => new Error("getaddrinfo ENOTFOUND api.nola.sh"));
    const err = (await requestTrial({ fetch: fn, baseUrl: "https://api.nola.sh" }).catch((e: unknown) => e)) as NolaApiError;
    expect(err).toBeInstanceOf(NolaApiError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/Could not reach the Nola API at https:\/\/api\.nola\.sh\/v1\/trial/);
    expect(err.message).toMatch(/ENOTFOUND/);
  });

  it("rejects a non-JSON error body with the generic message and a body with no key", async () => {
    const { fn } = fakeFetch(() => ({ status: 502, body: "<html>" }));
    const err = (await requestTrial({ fetch: fn }).catch((e: unknown) => e)) as NolaApiError;
    expect(err.message).toMatch(/^Nola API POST \/v1\/trial failed: 502/);
    expect(err.code).toBeUndefined();

    const { fn: noKey } = fakeFetch(() => ({
      status: 201,
      body: { account: { id: "a", kind: "anonymous" }, trial: { runs: 25 } },
    }));
    await expect(requestTrial({ fetch: noKey })).rejects.toThrow(/returned no API key/);
  });
});

describe("signed-in endpoints", () => {
  it("fetchCapabilities GETs /v1/capabilities without auth", async () => {
    const caps = { protocol: 1, ingest: false, auth: { issuer: "https://t.auth0.com", clientId: "cli", audience: "aud" }, consoleUrl: "https://platform.nola.sh" };
    const { fn, calls } = fakeFetch(() => ({ body: caps }));
    expect(await fetchCapabilities({ fetch: fn, baseUrl: "https://api.nola.sh" })).toEqual(caps);
    expect(calls[0]?.url).toBe("https://api.nola.sh/v1/capabilities");
    expect(calls[0]?.init.method).toBe("GET");
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("createConsoleKey POSTs /v1/console/keys with the access token and { name: 'cli' }, returns an account grant", async () => {
    const { fn, calls } = fakeFetch(() => ({
      status: 201,
      body: { id: "key_1", name: "cli", prefix: "nola_sk_aa", suffix: "aaaaaaaa", apiKey: KEY },
    }));
    expect(await createConsoleKey(AT, { fetch: fn, baseUrl: "https://api.nola.sh" })).toEqual({ apiKey: KEY, source: "account" });
    expect(calls[0]?.url).toBe("https://api.nola.sh/v1/console/keys");
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe(`Bearer ${AT}`);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ name: "cli" });
    const { fn: noKey } = fakeFetch(() => ({ status: 201, body: { id: "key_1", name: "cli", prefix: "x", suffix: null } }));
    await expect(createConsoleKey(AT, { fetch: noKey })).rejects.toThrow(/returned no API key/);
  });

  it("fetchMe GETs /v1/console/me with the access token", async () => {
    const me = {
      user: { id: "usr_1", email: "dev@example.com", name: null, avatarUrl: null },
      account: { id: "acct_1", kind: "user", status: "active", mode: "trial", trial: { runsUsed: 3, runsLimit: 25 }, balanceMicro: 0, spendThisMonthMicro: 0, liveKeyCount: 1 },
    };
    const { fn, calls } = fakeFetch(() => ({ body: me }));
    expect(await fetchMe(AT, { fetch: fn, baseUrl: "https://api.nola.sh" })).toEqual(me);
    expect(calls[0]?.url).toBe("https://api.nola.sh/v1/console/me");
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe(`Bearer ${AT}`);
  });

  it("createBillingSession (key bearer) and claimSession (access token, encoded id) — the claim carrier", async () => {
    const { fn, calls } = fakeFetch((call) =>
      call.url.endsWith("/v1/billing/session")
        ? { status: 201, body: { url: "https://platform.nola.sh/billing?session=bill_1", expiresAt: "2026-08-24T00:15:00Z" } }
        : { body: { outcome: "claimed", accountId: "acct_1" } },
    );
    const session = await createBillingSession(KEY, { fetch: fn, baseUrl: "https://api.nola.sh" });
    expect(session.url).toBe("https://platform.nola.sh/billing?session=bill_1");
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(sessionIdOf(session.url)).toBe("bill_1");
    expect(sessionIdOf("https://platform.nola.sh/billing")).toBeUndefined();
    expect(sessionIdOf("not a url")).toBeUndefined();
    expect(await claimSession(AT, "bill_1", { fetch: fn, baseUrl: "https://api.nola.sh" })).toEqual({ outcome: "claimed", accountId: "acct_1" });
    expect(calls[1]?.url).toBe("https://api.nola.sh/v1/console/sessions/bill_1/claim");
    expect((calls[1]?.init.headers as Record<string, string>).authorization).toBe(`Bearer ${AT}`);
  });
});
