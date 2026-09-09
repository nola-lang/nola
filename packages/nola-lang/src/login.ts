import {
  type ClientInit,
  claimNote,
  claimProjectKey,
  nolaApiUrl,
  openBrowser,
  SignInError,
  SignInUnavailableError,
  signIn,
  signOut,
} from "create-nola-lang";

/**
 * `nola login` / `nola logout` (spec 2026-09-04-cli-sign-in-design.md §5).
 * Login runs the Auth0 Authorization Code + PKCE flow (the browser opened
 * best-effort onto a loopback callback, then waits; platform spec 2026-09-07),
 * stores the session in ~/.nola/credentials.json, and — when the
 * current directory's .env holds a NOLA_API_KEY — links that key's account to
 * the user's account. Logout revokes best-effort and forgets the session.
 */
export interface LoginOptions extends ClientInit {
  /** the project directory whose .env may hold a key to claim; default "." */
  cwd?: string;
  /** the directory holding .nola/; default os.homedir() */
  home?: string;
  /** browser opener; default openBrowser */
  open?: (url: string) => boolean;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

const describe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function cmdLogin(opts: LoginOptions = {}): Promise<number> {
  const out = opts.out ?? ((line: string) => console.log(line));
  const err = opts.err ?? ((line: string) => console.error(line));
  const apiUrl = (opts.baseUrl ?? nolaApiUrl()).replace(/\/$/, "");
  const auth = { ...(opts.home !== undefined ? { home: opts.home } : {}), apiUrl, ...(opts.fetch ? { fetch: opts.fetch } : {}) };
  let accessToken: string;
  try {
    ({ accessToken } = await signIn({ ...auth, note: out, open: opts.open ?? openBrowser }));
  } catch (e) {
    err(e instanceof SignInUnavailableError || e instanceof SignInError ? e.message : `Could not sign in: ${describe(e)}`);
    return 1;
  }
  const claim = await claimProjectKey(opts.cwd ?? ".", accessToken, auth);
  if (claim) out(claimNote(claim));
  return 0;
}

export async function cmdLogout(opts: LoginOptions = {}): Promise<number> {
  const out = opts.out ?? ((line: string) => console.log(line));
  const apiUrl = (opts.baseUrl ?? nolaApiUrl()).replace(/\/$/, "");
  const result = await signOut({ ...(opts.home !== undefined ? { home: opts.home } : {}), apiUrl, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  out(result === "signed-out" ? "Signed out of Nola." : "Not signed in.");
  return 0;
}
