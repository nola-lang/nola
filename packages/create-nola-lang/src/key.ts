import { type ClientInit, claimSession, createBillingSession, createConsoleKey, isSessionRejected, type KeyGrant, nolaApiUrl, requestTrial, sessionIdOf } from "./api.js";
import { type AuthOptions, accessTokenFor, signIn } from "./auth.js";
import { deleteSession } from "./credentials.js";
import { readHomeConfig, recordTrialAccount } from "./home-config.js";
import { readEnvKey } from "./trial.js";

/**
 * How the CLI gets an API key (spec 2026-09-04-cli-sign-in-design.md §4).
 * Signed in → a key on the personal account (`POST /v1/console/keys`). Not
 * signed in on a machine that already used its anonymous trial → sign in
 * (interactive) or `SignInRequiredError`. A fresh machine → the one
 * anonymous trial, recorded in `config.json`. Shared by the scaffold
 * (`runFlow`) and `nola key`.
 */

/** Non-interactive, no session, and this machine's free trial is used: the caller must say how to sign in. */
export class SignInRequiredError extends Error {
  override name = "SignInRequiredError";
  constructor() {
    super("This machine already used its 25 free Nola runs. Sign in with `npx nola-lang login` to get an API key for this project.");
  }
}

export interface AcquireKeyOptions extends AuthOptions {
  /** may the sign-in flow run (browser + waiting)? false = SignInRequiredError instead */
  interactive: boolean;
  /** human-facing progress lines (sign-in instructions, "Signed in as …") */
  note: (message: string) => void;
  open?: (url: string) => boolean;
  /**
   * Asked once, interactively, when this machine's trial is used and the next
   * step is the browser sign-in — BEFORE anything opens. Anything but `true`
   * declines: SignInRequiredError, no request made. Absent = proceed (the
   * scaffold flow asks its own question first).
   */
  confirmSignIn?: () => Promise<boolean | null>;
}

function client(opts: AuthOptions): { apiUrl: string; client: ClientInit } {
  const apiUrl = (opts.apiUrl ?? opts.baseUrl ?? nolaApiUrl()).replace(/\/$/, "");
  return { apiUrl, client: { ...(opts.fetch ? { fetch: opts.fetch } : {}), baseUrl: apiUrl } };
}

export async function acquireKey(opts: AcquireKeyOptions): Promise<KeyGrant> {
  const { apiUrl, client: c } = client(opts);
  const authOpts: AuthOptions = { ...(opts.home !== undefined ? { home: opts.home } : {}), apiUrl, ...(opts.fetch ? { fetch: opts.fetch } : {}) };

  const signedIn = await accessTokenFor(authOpts);
  if (signedIn) {
    try {
      return await createConsoleKey(signedIn.token, c);
    } catch (err) {
      if (!isSessionRejected(err)) throw err;
      // the server no longer accepts this session: forget it and continue as signed out
      await deleteSession(opts.home, apiUrl);
    }
  }

  const previous = (await readHomeConfig(opts.home))?.accounts[apiUrl];
  if (previous) {
    if (!opts.interactive) throw new SignInRequiredError();
    if (opts.confirmSignIn && (await opts.confirmSignIn()) !== true) throw new SignInRequiredError();
    const session = await signIn({ ...authOpts, note: opts.note, ...(opts.open ? { open: opts.open } : {}) });
    return createConsoleKey(session.accessToken, c);
  }

  const grant = await requestTrial(c);
  if ((await recordTrialAccount(opts.home, apiUrl, { accountId: grant.accountId ?? "", issuedAt: new Date().toISOString() })) === "skipped") {
    opts.note("Could not record the trial account in ~/.nola/config.json — the key still works.");
  }
  return grant;
}

/**
 * Opportunistic merge: when signed in and `<dir>/.env` holds a NOLA_API_KEY,
 * link that key's (anonymous) account to the user's account through the
 * existing billing-session + claim endpoints. Answers what happened for a
 * note, or undefined when there was nothing to claim. Never throws — a failed
 * claim is reported, not fatal.
 */
export async function claimProjectKey(
  dir: string,
  accessToken: string,
  opts: AuthOptions = {},
): Promise<{ outcome: "claimed" | "merged" | "already_owned" } | { error: string } | undefined> {
  const apiKey = await readEnvKey(dir);
  if (!apiKey) return undefined;
  const { client: c } = client(opts);
  try {
    const session = await createBillingSession(apiKey, c);
    const id = sessionIdOf(session.url);
    if (!id) return { error: "the billing session carried no id" };
    const claim = await claimSession(accessToken, id, c);
    return { outcome: claim.outcome };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** The one-line note for a claim outcome. */
export function claimNote(result: NonNullable<Awaited<ReturnType<typeof claimProjectKey>>>): string {
  if ("error" in result) return `Could not link this project's trial account to your Nola account: ${result.error}`;
  switch (result.outcome) {
    case "claimed":
      return "Linked this project's trial account to your Nola account.";
    case "merged":
      return "Merged this project's trial account into your Nola account.";
    default:
      return "This project's account is already yours.";
  }
}
