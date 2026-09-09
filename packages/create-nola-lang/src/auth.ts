import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { type ClientInit, fetchCapabilities, type NolaAuthConfig, nolaApiUrl } from "./api.js";
import { deleteSession, readSession, type Session, writeSession } from "./credentials.js";
import { readHomeConfig } from "./home-config.js";
import { openBrowser } from "./open-url.js";

/**
 * Sign-in for the CLI: the Auth0 Authorization Code + PKCE flow (RFC 7636)
 * with a loopback redirect (RFC 8252 §7.3), against the tenant the Nola API
 * names in `GET /v1/capabilities` (platform spec 2026-09-07 §6). The machine's
 * recorded trial account id rides `/authorize` as `ext-nola_account`; the
 * tenant's Action puts it in the access token and the API claims the account.
 * Zero deps — node:http for the one callback, form-encoded POSTs over fetch.
 * Tokens live in `~/.nola/credentials.json` and are never printed.
 */

/** The server does not offer sign-in (no `auth` in its capabilities). */
export class SignInUnavailableError extends Error {
  override name = "SignInUnavailableError";
  constructor(message = "Sign-in is not available on this Nola server yet.") {
    super(message);
  }
}

/** The sign-in ran but did not complete (denied, expired, network, malformed reply). */
export class SignInError extends Error {
  override name = "SignInError";
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** seconds */
  expiresIn: number;
  idToken?: string;
}

/** Mirrors core's NOLA_ACCOUNT_PARAM — the /authorize query parameter the tenant's post-login Action reads. */
export const ACCOUNT_PARAM = "ext-nola_account";
/** Mirrors core's NOLA_ACCOUNT_CLAIM — the access-token claim the Action sets; the API refuses tokens without it (spec 2026-09-07 account-claim-required). */
export const ACCOUNT_CLAIM = "nola:account_id";
/** How long the browser has to come back to the loopback callback. */
export const SIGN_IN_TIMEOUT_MS = 300_000;
const SCOPE = "openid profile email offline_access";
const CALLBACK_PATH = "/callback";
/** Refresh when the access token has less than this left. */
const REFRESH_MARGIN_MS = 60_000;

type Form = Record<string, string>;

async function postForm(
  init: ClientInit,
  url: string,
  form: Form,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const doFetch = init.fetch ?? globalThis.fetch;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(form).toString(),
    });
  } catch (err) {
    throw new SignInError(`Could not reach the sign-in provider at ${url}: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    });
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = text === "" ? {} : JSON.parse(text);
  } catch {
    body = {};
  }
  return { ok: res.ok, status: res.status, body: typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {} };
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

function describe(body: Record<string, unknown>, fallback: string): string {
  return str(body.error_description) ?? str(body.error) ?? fallback;
}

function tokenSetOf(body: Record<string, unknown>): TokenSet {
  const accessToken = str(body.access_token);
  if (!accessToken) throw new SignInError("Sign-in did not complete: the provider returned no access token.");
  return {
    accessToken,
    ...(str(body.refresh_token) ? { refreshToken: str(body.refresh_token) as string } : {}),
    expiresIn: num(body.expires_in, 3600),
    ...(str(body.id_token) ? { idToken: str(body.id_token) as string } : {}),
  };
}

/** RFC 7636: a 32-byte random verifier and its S256 challenge, both base64url. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** The `/authorize` URL: code flow, PKCE S256, our audience and scopes, `state`, and the trial hint when this machine has one. */
export function authorizeUrl(auth: NolaAuthConfig, p: { redirectUri: string; challenge: string; state: string; accountId?: string }): string {
  const u = new URL(`${auth.issuer}/authorize`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", auth.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("scope", SCOPE);
  u.searchParams.set("audience", auth.audience);
  u.searchParams.set("code_challenge", p.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", p.state);
  if (p.accountId) u.searchParams.set(ACCOUNT_PARAM, p.accountId);
  return u.href;
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] as string);
const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title><body style="font:16px system-ui;margin:3rem auto;max-width:32rem"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></body>`;

type Handler = NonNullable<Parameters<typeof createServer>[1]>;

/** Bind 127.0.0.1 on the first free port of the list (0 = any, tests only). All busy → SignInError. */
async function listenOnOneOf(ports: readonly number[], handler: Handler): Promise<{ server: Server; port: number }> {
  for (const port of ports) {
    const server = createServer(handler);
    const bound = await new Promise<number | undefined>((resolve, reject) => {
      server.once("error", (err: NodeJS.ErrnoException) => (err.code === "EADDRINUSE" || err.code === "EACCES" ? resolve(undefined) : reject(err)));
      server.listen(port, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
    });
    if (bound !== undefined) return { server, port: bound };
  }
  throw new SignInError(`Sign-in could not start: ports ${ports.join(", ")} on 127.0.0.1 are in use.`);
}

type Settle = { resolve: (code: string) => void; reject: (err: Error) => void };

/**
 * The one callback: `run` gets the redirect URI once the listener is up (and
 * opens the browser); the promise is the authorization code, or the
 * user-facing SignInError. The browser tab gets a page either way; the
 * listener closes as soon as the outcome is known or the deadline passes.
 */
async function awaitCallback(ports: readonly number[], state: string, timeoutMs: number, run: (redirectUri: string) => void): Promise<string> {
  let settle: Settle | undefined;
  const result = new Promise<string>((resolve, reject) => {
    settle = { resolve, reject };
  });
  // `connection: close`: the browser's socket ends with the page, so closing the server below never waits on keep-alive
  const html = { "content-type": "text/html; charset=utf-8", connection: "close" };
  const { server, port } = await listenOnOneOf(ports, (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { "content-type": "text/plain", connection: "close" }).end("not found");
      return;
    }
    if (!settle) {
      res.writeHead(410, html).end(page("Nola", "This sign-in already finished. Return to the terminal."));
      return;
    }
    const { resolve, reject } = settle;
    settle = undefined;
    const q = url.searchParams;
    if (q.get("state") !== state) {
      res.writeHead(400, html).end(page("Sign-in failed", "The browser returned an unexpected state. Return to the terminal and run the command again."));
      reject(new SignInError("Sign-in failed: the browser returned an unexpected state."));
      return;
    }
    const error = q.get("error");
    if (error) {
      const reason = error === "access_denied" ? "Sign-in was declined in the browser." : `Sign-in failed: ${q.get("error_description") ?? error}`;
      res.writeHead(200, html).end(page("Sign-in failed", `${reason} Return to the terminal.`));
      reject(new SignInError(reason));
      return;
    }
    const code = q.get("code");
    if (!code) {
      res.writeHead(400, html).end(page("Sign-in failed", "The browser returned no code. Return to the terminal and run the command again."));
      reject(new SignInError("Sign-in failed: the browser returned no authorization code."));
      return;
    }
    res.writeHead(200, html).end(page("Signed in to Nola", "You can close this tab and return to the terminal."));
    resolve(code);
  });
  const timer = setTimeout(() => {
    settle?.reject(new SignInError("Sign-in timed out — the browser did not come back within 5 minutes. Run the command again."));
    settle = undefined;
  }, timeoutMs);
  try {
    run(`http://127.0.0.1:${port}${CALLBACK_PATH}`);
    return await result;
  } finally {
    clearTimeout(timer);
    // stop accepting; drop idle keep-alive sockets (a browser's speculative second connection) but let the page finish sending
    const closed = new Promise<void>((r) => server.close(() => r()));
    server.closeIdleConnections();
    await closed;
  }
}

/** A JWT's payload, decoded and NOT verified — display and sanity checks only; the API is the verifier. */
function claimsOf(token: string | undefined): Record<string, unknown> | null {
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The `email` claim of an id token's payload — display only, never verified. */
export function emailFromIdToken(idToken: string | undefined): string | null {
  return str(claimsOf(idToken)?.email) ?? null;
}

/** The `nola:account_id` claim of an access token, or null when the tenant's Action did not set one. */
export function accountIdOfToken(accessToken: string | undefined): string | null {
  return str(claimsOf(accessToken)?.[ACCOUNT_CLAIM]) ?? null;
}

/** A refresh; Auth0's rotating refresh tokens return a replacement, which callers store. */
export async function refreshTokens(auth: NolaAuthConfig, refreshToken: string, init: ClientInit = {}): Promise<TokenSet> {
  const { ok, status, body } = await postForm(init, `${auth.issuer}/oauth/token`, {
    grant_type: "refresh_token",
    client_id: auth.clientId,
    refresh_token: refreshToken,
  });
  if (!ok) {
    const err = new SignInError(`Your Nola session could not be refreshed (${status}): ${describe(body, "refresh failed")}`);
    (err as SignInError & { status: number }).status = status;
    throw err;
  }
  return tokenSetOf(body);
}

/** Best effort: tell the tenant the refresh token is dead. Never throws. */
export async function revokeToken(auth: NolaAuthConfig, refreshToken: string, init: ClientInit = {}): Promise<void> {
  const doFetch = init.fetch ?? globalThis.fetch;
  try {
    await doFetch(`${auth.issuer}/oauth/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: auth.clientId, token: refreshToken }),
    });
  } catch {
    // the local session is deleted regardless
  }
}

export interface AuthOptions extends ClientInit {
  /** the directory holding .nola/; default os.homedir() */
  home?: string;
  /** API base URL; default NOLA_API_URL env, else https://api.nola.sh */
  apiUrl?: string;
}

function resolve(opts: AuthOptions): { apiUrl: string; client: ClientInit } {
  const apiUrl = (opts.apiUrl ?? opts.baseUrl ?? nolaApiUrl()).replace(/\/$/, "");
  return { apiUrl, client: { ...(opts.fetch ? { fetch: opts.fetch } : {}), baseUrl: apiUrl } };
}

/** The server's sign-in configuration (issuer, client, audience, at least one usable loopback port), or SignInUnavailableError. */
export async function authConfig(opts: AuthOptions = {}): Promise<{ auth: NolaAuthConfig; consoleUrl?: string }> {
  const { client } = resolve(opts);
  const caps = await fetchCapabilities(client);
  const auth = caps.auth;
  const ports = Array.isArray(auth?.redirectPorts) ? auth.redirectPorts.filter((p) => Number.isInteger(p) && p >= 0 && p <= 65535) : [];
  if (!auth || !str(auth.issuer) || !str(auth.clientId) || !str(auth.audience) || ports.length === 0) throw new SignInUnavailableError();
  return {
    auth: { issuer: auth.issuer.replace(/\/$/, ""), clientId: auth.clientId, audience: auth.audience, redirectPorts: ports },
    ...(caps.consoleUrl ? { consoleUrl: caps.consoleUrl } : {}),
  };
}

export interface SignInOptions extends AuthOptions {
  /** human-facing progress lines (the URL, "Waiting…", "Signed in as …") */
  note: (message: string) => void;
  /** browser opener; default openBrowser (openUrl unless NOLA_NO_BROWSER / NOLA_BROWSER). Return false when nothing could be opened — the URL is always noted anyway. */
  open?: (url: string) => boolean;
  /** how long to wait for the callback; default SIGN_IN_TIMEOUT_MS */
  timeoutMs?: number;
}

function sessionOf(tokens: TokenSet, previous?: Session): Session {
  const refreshToken = tokens.refreshToken ?? previous?.refreshToken;
  if (!refreshToken) throw new SignInError("Sign-in did not complete: the provider returned no refresh token (offline_access is required).");
  return {
    accessToken: tokens.accessToken,
    refreshToken,
    expiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
    email: emailFromIdToken(tokens.idToken) ?? previous?.email ?? null,
  };
}

/** The whole PKCE flow: discover, listen, open /authorize, take the callback, exchange, store. Returns the new session. */
export async function signIn(opts: SignInOptions): Promise<Session> {
  const { apiUrl, client } = resolve(opts);
  const { auth } = await authConfig(opts);
  const { verifier, challenge } = pkcePair();
  const state = randomBytes(16).toString("base64url");
  const accountId = (await readHomeConfig(opts.home))?.accounts[apiUrl]?.accountId;
  let redirectUri = "";
  const code = await awaitCallback(auth.redirectPorts ?? [], state, opts.timeoutMs ?? SIGN_IN_TIMEOUT_MS, (uri) => {
    redirectUri = uri;
    const url = authorizeUrl(auth, { redirectUri, challenge, state, ...(accountId ? { accountId } : {}) });
    opts.note(`Sign in to Nola: open ${url}`);
    (opts.open ?? openBrowser)(url);
    opts.note("Waiting for the browser…");
  });
  const { ok, status, body } = await postForm(client, `${auth.issuer}/oauth/token`, {
    grant_type: "authorization_code",
    client_id: auth.clientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });
  if (!ok) throw new SignInError(`Sign-in failed (${status}): ${describe(body, "token request failed")}`);
  const session = sessionOf(tokenSetOf(body));
  // account-claim-required: the tenant's Action provisions the account at login and names it in the token; a token without it is useless to the API
  if (!accountIdOfToken(session.accessToken)) {
    throw new SignInError("Sign-in did not return your Nola account — the server's sign-in provider is misconfigured. Nothing was stored.");
  }
  if ((await writeSession(opts.home, apiUrl, session)) === "skipped") {
    opts.note("Could not store the session in ~/.nola/credentials.json — you will be asked to sign in again next time.");
  }
  opts.note(session.email ? `Signed in as ${session.email}.` : "Signed in.");
  return session;
}

/**
 * A usable access token for the API URL, refreshing (and re-storing) when
 * the stored one is within a minute of expiry. undefined = not signed in. A
 * refresh the tenant refuses deletes the session (the user signs in again);
 * a network failure during refresh throws so callers can say so.
 */
export async function accessTokenFor(opts: AuthOptions = {}): Promise<{ token: string; session: Session } | undefined> {
  const { apiUrl, client } = resolve(opts);
  const session = await readSession(opts.home, apiUrl);
  if (!session) return undefined;
  if (Date.parse(session.expiresAt) - Date.now() > REFRESH_MARGIN_MS) return { token: session.accessToken, session };
  const { auth } = await authConfig(opts);
  let tokens: TokenSet;
  try {
    tokens = await refreshTokens(auth, session.refreshToken, client);
  } catch (err) {
    if (err instanceof SignInError && typeof (err as SignInError & { status?: number }).status === "number") {
      await deleteSession(opts.home, apiUrl);
      return undefined;
    }
    throw err;
  }
  const next = sessionOf(tokens, session);
  await writeSession(opts.home, apiUrl, next);
  return { token: next.accessToken, session: next };
}

/** Revoke best-effort and forget the session. */
export async function signOut(opts: AuthOptions = {}): Promise<"signed-out" | "not-signed-in"> {
  const { apiUrl, client } = resolve(opts);
  const session = await readSession(opts.home, apiUrl);
  if (!session) return "not-signed-in";
  try {
    const { auth } = await authConfig(opts);
    await revokeToken(auth, session.refreshToken, client);
  } catch {
    // unreachable tenant or a server without auth: the local session still goes
  }
  await deleteSession(opts.home, apiUrl);
  return "signed-out";
}
