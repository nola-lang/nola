import type {
  NolaAuthConfig as NolaAuthConfigWire,
  NolaBillingSessionResponse,
  NolaCapabilitiesResponse,
  NolaClaimResponse,
  NolaConsoleCreatedKeyResponse,
  NolaConsoleMeResponse,
  NolaTrialResponse,
} from "@nola-lang/core";
import {
  accessTokenFor,
  type ClientInit,
  claimNote,
  claimProjectKey,
  deleteSession,
  fetchCapabilities,
  fetchMe,
  isSessionRejected,
  type NolaTrialResponse as MirroredTrialResponse,
  type NolaAuthConfig,
  type NolaBillingSession,
  type NolaCapabilities,
  type NolaClaim,
  type NolaConsoleCreatedKey,
  type NolaConsoleMe,
  nolaApiUrl,
  openBrowser,
  SignInError,
  SignInUnavailableError,
  signIn,
} from "create-nola-lang";

// create-nola-lang ships with zero deps and mirrors core's wire shapes
// structurally; this is the compile-time pin that keeps the mirror honest
// (both sides must stay identical).
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const WIRE_MIRROR: [
  Same<NolaBillingSession, NolaBillingSessionResponse>,
  Same<MirroredTrialResponse, NolaTrialResponse>,
  Same<NolaCapabilities, NolaCapabilitiesResponse>,
  Same<NolaAuthConfig, NolaAuthConfigWire>,
  Same<NolaConsoleCreatedKey, NolaConsoleCreatedKeyResponse>,
  Same<NolaConsoleMe, NolaConsoleMeResponse>,
  Same<NolaClaim, NolaClaimResponse>,
] = [true, true, true, true, true, true, true];
void WIRE_MIRROR;

export interface AccountOptions extends ClientInit {
  /** the project directory whose .env may hold a key to claim; default "." */
  cwd?: string;
  /** the directory holding .nola/credentials.json; default os.homedir() */
  home?: string;
  /** may the sign-in flow run? default: stdin AND stdout are TTYs */
  interactive?: boolean;
  /** browser opener; default openBrowser */
  open?: (url: string) => boolean;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

const describeError = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The console's public origin — the fallback when a server's capabilities name none. */
export const CONSOLE_URL = "https://platform.nola.sh";

/** Where "bring your own provider" is explained; the runtime's missing-key error points here. */
export const PROVIDER_DOCS_URL = "https://nola.sh/docs/reference/providers-api/";

/** `$12.35` from micro-dollars; the console shows the same figure. */
const formatBalance = (microUsd: number): string => `$${(microUsd / 1_000_000).toFixed(2)}`;

/** A per-million-token price: two decimals, a third only when the price has one (`$0.25`, `$0.035`). */
export const formatPrice = (microPerMTok: number): string => {
  const three = (microPerMTok / 1_000_000).toFixed(3);
  return `$${three.endsWith("0") ? three.slice(0, -1) : three}`;
};

/** Phase 1: hosted inference is early access. Printed by `nola account`; the account page shows the same text. */
export const EARLY_ACCESS_NOTE =
  "Early access: The hosted Nola inference service is designed to help you get started quickly. For now, we recommend it for prototyping and development rather than production use.";

export const NOT_SIGNED_IN =
  "Not signed in. Run `npx nola-lang login` first — or run `npx nola-lang account` in an interactive terminal to sign in now.";

/**
 * `nola account` — the signed-in user's account page on the
 * console (spec 2026-09-04-cli-sign-in-design.md §5). Not signed in →
 * interactive: the browser sign-in runs here; non-interactive: exit 1. Signed in
 * (a stored session, refreshed when stale): link the current project's key to
 * the account when there is one, print the account line and balance, open
 * `<consoleUrl>/account` — the browser holds its own Auth0 session, so no
 * CLI-minted session is needed. Works from ANY directory.
 */
export async function cmdAccount(opts: AccountOptions = {}): Promise<number> {
  const out = opts.out ?? ((line: string) => console.log(line));
  const err = opts.err ?? ((line: string) => console.error(line));
  const apiUrl = (opts.baseUrl ?? nolaApiUrl()).replace(/\/$/, "");
  const auth = { ...(opts.home !== undefined ? { home: opts.home } : {}), apiUrl, ...(opts.fetch ? { fetch: opts.fetch } : {}) };
  const client: ClientInit = { ...(opts.fetch ? { fetch: opts.fetch } : {}), baseUrl: apiUrl };
  const interactive = opts.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);

  let accessToken: string;
  try {
    const stored = await accessTokenFor(auth);
    if (stored) {
      accessToken = stored.token;
    } else if (!interactive) {
      err(NOT_SIGNED_IN);
      return 1;
    } else {
      ({ accessToken } = await signIn({ ...auth, note: out, open: opts.open ?? openBrowser }));
    }
  } catch (e) {
    err(e instanceof SignInUnavailableError || e instanceof SignInError ? e.message : `Could not sign in: ${describeError(e)}`);
    return 1;
  }

  const claim = await claimProjectKey(opts.cwd ?? ".", accessToken, auth);
  if (claim) out(claimNote(claim));

  let me: NolaConsoleMe;
  let consoleUrl = CONSOLE_URL;
  try {
    me = await fetchMe(accessToken, client);
    consoleUrl = (await fetchCapabilities(client)).consoleUrl?.replace(/\/$/, "") ?? CONSOLE_URL;
  } catch (e) {
    if (isSessionRejected(e)) {
      await deleteSession(opts.home, apiUrl);
      err("Your Nola session is no longer valid. Run `npx nola-lang login` to sign in again.");
      return 1;
    }
    err(`Could not read the Nola account: ${describeError(e)}`);
    return 1;
  }
  const who = me.user.email ?? "signed in";
  out(`Nola account: ${who} — ${me.account.trial.runsUsed} / ${me.account.trial.runsLimit} free runs used`);
  out(`Balance  ${formatBalance(me.account.balanceMicro)}`);
  out("");
  out(EARLY_ACCESS_NOTE);
  out("");
  const url = `${consoleUrl}/account`;
  out(`Opening ${url}`);
  out("If your browser did not open, visit the link above.");
  (opts.open ?? openBrowser)(url);
  return 0;
}
