import { ownVersion } from "./scaffold.js";

/**
 * The hosted Nola API, from the scaffolder's side. This package ships with
 * ZERO runtime deps, so the wire shapes below are structural mirrors of
 * `@nola-lang/core`'s `nola-protocol.ts` (the authoritative contract the
 * platform imports); `packages/nola-lang/src/account.ts` pins them equal at
 * compile time.
 */

export const DEFAULT_API_URL = "https://api.nola.sh";

/** `NOLA_API_URL` overrides the endpoint (dev: http://127.0.0.1:8787 against `wrangler dev`). */
export function nolaApiUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.NOLA_API_URL || DEFAULT_API_URL).replace(/\/$/, "");
}

export interface ClientInit {
  fetch?: typeof globalThis.fetch;
  /** default: nolaApiUrl() */
  baseUrl?: string;
}

// ---- wire shapes (mirrors of @nola-lang/core nola-protocol.ts) ----

export type NolaAccountKind = "anonymous" | "user";

export interface NolaTrialResponse {
  apiKey: string;
  account: { id: string; kind: NolaAccountKind };
  trial: { runs: number };
}

/** Where the CLI signs in: the Auth0 tenant (`issuer` = https://<domain>), the CLI's public client id, the API audience, the loopback ports registered for the PKCE callback. */
export interface NolaAuthConfig {
  issuer: string;
  clientId: string;
  audience: string;
  /** `http://127.0.0.1:<port>/callback` is registered on the tenant for each; the CLI binds the first free one. Absent or empty = no sign-in here. */
  redirectPorts?: readonly number[];
}

export interface NolaCapabilities {
  protocol: 1;
  infer?: boolean;
  ingest: boolean;
  profiles?: readonly string[];
  /** absent when sign-in is not available on this server */
  auth?: NolaAuthConfig;
  /** the console origin (billing page, account) — absent on servers without a console */
  consoleUrl?: string;
}

export interface NolaBillingSession {
  url: string;
  /** ISO-8601 */
  expiresAt: string;
}

/** POST /v1/console/keys — 201; the raw key appears here exactly once. */
export interface NolaConsoleCreatedKey {
  id: string;
  name: string | null;
  prefix: string;
  suffix: string | null;
  apiKey: string;
}

/** GET /v1/console/me — the signed-in user and their personal account. */
export interface NolaConsoleMe {
  user: { id: string; email: string | null; name: string | null; avatarUrl: string | null };
  account: {
    id: string;
    kind: NolaAccountKind;
    status: "active" | "suspended";
    mode: "trial" | "paid";
    trial: { runsUsed: number; runsLimit: number };
    balanceMicro: number;
    spendThisMonthMicro: number;
    liveKeyCount: number;
  };
}

/** POST /v1/console/sessions/:id/claim — links a key's (anonymous) account to the signed-in user. */
export interface NolaClaim {
  outcome: "claimed" | "merged" | "already_owned";
  accountId: string;
}

interface NolaErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

/** A failed API call. `status` 0 means the request never got an HTTP answer (offline, DNS, refused). */
export class NolaApiError extends Error {
  override name = "NolaApiError";
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryAfterMs?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/**
 * The API no longer accepts this Auth0 session: an invalid token (401), or a token
 * without / with a stale `nola:account_id` (403 `account_claim_missing` /
 * `account_mismatch`, spec 2026-09-07 account-claim-required). The cure is the same:
 * forget the session and sign in again, which re-provisions the account.
 */
export function isSessionRejected(err: unknown): err is NolaApiError {
  if (!(err instanceof NolaApiError)) return false;
  if (err.status === 401) return true;
  return err.status === 403 && (err.code === "account_claim_missing" || err.code === "account_mismatch");
}

/** Retry-After is either delta-seconds or an HTTP-date; both become a ms delta. */
function parseRetryAfter(header: string | null): number | undefined {
  if (header === null || header.trim() === "") return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function parseErrorBody(text: string): NolaErrorBody["error"] | undefined {
  try {
    const parsed = JSON.parse(text) as Partial<NolaErrorBody> | null;
    const e = parsed?.error;
    if (e && typeof e === "object" && typeof e.code === "string" && typeof e.message === "string") return e;
  } catch {
    // not JSON
  }
  return undefined;
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  init: ClientInit & { bearer?: string; body?: unknown },
): Promise<{ status: number; body: T }> {
  const doFetch = init.fetch ?? globalThis.fetch;
  const url = `${init.baseUrl ?? nolaApiUrl()}${path}`;
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": `create-nola-lang/${await ownVersion()}`,
  };
  if (init.bearer) headers.authorization = `Bearer ${init.bearer}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await doFetch(url, {
      method,
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch (err) {
    throw new NolaApiError(
      `Could not reach the Nola API at ${url}: ${err instanceof Error ? err.message : String(err)}`,
      0,
      undefined,
      undefined,
      { cause: err },
    );
  }
  const text = await res.text();
  if (!res.ok) {
    const wire = parseErrorBody(text);
    const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
    throw new NolaApiError(
      wire?.message ??
        `Nola API ${method} ${path} failed: ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 300)}` : ""}`,
      res.status,
      wire?.code,
      retryAfterMs,
    );
  }
  try {
    return { status: res.status, body: JSON.parse(text) as T };
  } catch {
    throw new NolaApiError(`Nola API ${method} ${path} returned a non-JSON body`, res.status);
  }
}

/** A key the CLI obtained: from the machine's one anonymous trial, or minted on the signed-in user's account. */
export interface KeyGrant {
  apiKey: string;
  source: "trial" | "account";
  /** the account the key belongs to, when the server said */
  accountId?: string;
  /** the trial's run limit (the public offer, 25) — trial keys only */
  runs?: number;
}

/**
 * POST /v1/trial — mint an anonymous trial account and its key. The body is
 * always the empty object: nothing on this machine identifies it to the
 * server (spec 2026-09-02-home-config-trial-identity-design.md §6).
 */
export async function requestTrial(init: ClientInit = {}): Promise<KeyGrant> {
  const { status, body } = await request<Partial<NolaTrialResponse>>("POST", "/v1/trial", { ...init, body: {} });
  if (typeof body?.apiKey !== "string" || !body.apiKey.startsWith("nola_sk_")) {
    throw new NolaApiError("Nola API POST /v1/trial returned no API key", status);
  }
  return {
    apiKey: body.apiKey,
    source: "trial",
    runs: body.trial?.runs ?? 0,
    accountId: body.account?.id ?? "",
  };
}

/** GET /v1/capabilities — what this server offers; the CLI reads `auth` (sign-in) and `consoleUrl`. */
export async function fetchCapabilities(init: ClientInit = {}): Promise<NolaCapabilities> {
  return (await request<NolaCapabilities>("GET", "/v1/capabilities", init)).body;
}

/** POST /v1/console/keys — a new key on the signed-in user's account (Auth0 access token as Bearer). */
export async function createConsoleKey(accessToken: string, init: ClientInit = {}): Promise<KeyGrant> {
  const { status, body } = await request<Partial<NolaConsoleCreatedKey>>("POST", "/v1/console/keys", {
    ...init,
    bearer: accessToken,
    body: { name: "cli" },
  });
  if (typeof body?.apiKey !== "string" || !body.apiKey.startsWith("nola_sk_")) {
    throw new NolaApiError("Nola API POST /v1/console/keys returned no API key", status);
  }
  return { apiKey: body.apiKey, source: "account" };
}

/** GET /v1/console/me — the signed-in user and their account (Auth0 access token as Bearer). */
export async function fetchMe(accessToken: string, init: ClientInit = {}): Promise<NolaConsoleMe> {
  return (await request<NolaConsoleMe>("GET", "/v1/console/me", { ...init, bearer: accessToken })).body;
}

/** POST /v1/billing/session — a short-lived session for the key's account; used as the claim carrier (the key never leaves this process). */
export async function createBillingSession(apiKey: string, init: ClientInit = {}): Promise<NolaBillingSession> {
  return (await request<NolaBillingSession>("POST", "/v1/billing/session", { ...init, bearer: apiKey, body: {} })).body;
}

/** POST /v1/console/sessions/:id/claim — link the session's account to the signed-in user (Auth0 access token as Bearer). */
export async function claimSession(accessToken: string, sessionId: string, init: ClientInit = {}): Promise<NolaClaim> {
  return (
    await request<NolaClaim>("POST", `/v1/console/sessions/${encodeURIComponent(sessionId)}/claim`, {
      ...init,
      bearer: accessToken,
      body: {},
    })
  ).body;
}

/** The session id a billing-session URL carries (`…/billing?session=bill_…`, from `POST /v1/billing/session`); undefined when the URL has none. */
export function sessionIdOf(url: string): string | undefined {
  try {
    return new URL(url).searchParams.get("session") ?? undefined;
  } catch {
    return undefined;
  }
}
