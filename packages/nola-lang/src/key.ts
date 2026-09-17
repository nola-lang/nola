import {
  acquireKey,
  type ClientInit,
  hasEnvKey,
  type KeyGrant,
  nolaApiUrl,
  openBrowser,
  SIGN_IN_QUESTION,
  SignInError,
  SignInRequiredError,
  SignInUnavailableError,
  writeEnvKey,
} from "create-nola-lang";

/**
 * `nola key [--print]` — get a Nola API key and offer it to the project's
 * `.env` (spec 2026-09-04-nola-key-command-design.md, ladder per
 * 2026-09-04-cli-sign-in-design.md §4): signed in → a key on the account; the
 * machine's trial used → sign in first (interactive) or exit 1; a fresh
 * machine → the anonymous trial. The key comes FIRST; then, interactively,
 * "Add it to .env?" (Yes highlighted) and — when `.env` already has a key —
 * "replace it?" (No highlighted). Esc/Ctrl+C at either question leaves the
 * file alone. `--print` puts the key ALONE on stdout; anything the sign-in
 * has to say goes to stderr. On a used machine the browser never opens
 * unasked: the scaffold's sign-in question comes first (Yes highlighted), and
 * a no or Esc is the sign-in note + exit 1.
 */
export interface KeyOptions extends ClientInit {
  /** stdout = the key, nothing else; never touches .env */
  print?: boolean;
  /** the project directory holding .env; default "." */
  cwd?: string;
  /** the directory holding .nola/; default os.homedir() */
  home?: string;
  /** default: stdin AND stdout are TTYs */
  interactive?: boolean;
  /** the Yes/No questions; null = cancelled (Esc / Ctrl+C). Default: the scaffold's clack confirm */
  confirm?: (question: string, initialValue: boolean) => Promise<boolean | null>;
  /** browser opener for the sign-in; default openBrowser */
  open?: (url: string) => boolean;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

export const ADD_TO_ENV_QUESTION = "Add it to .env?";
export const REPLACE_ENV_QUESTION = ".env already sets NOLA_API_KEY — replace it with the new key?";
const NOT_WRITTEN = "Not written — add the line above to .env yourself.";

async function clackConfirm(question: string, initialValue: boolean): Promise<boolean | null> {
  const { clackPrompter } = await import("create-nola-lang");
  return clackPrompter().confirm(question, initialValue);
}

export async function cmdKey(opts: KeyOptions = {}): Promise<number> {
  const out = opts.out ?? ((line: string) => console.log(line));
  const err = opts.err ?? ((line: string) => console.error(line));
  const cwd = opts.cwd ?? ".";
  const print = opts.print === true;
  const interactive = opts.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);

  const confirm = opts.confirm ?? clackConfirm;
  let grant: KeyGrant;
  try {
    grant = await acquireKey({
      confirmSignIn: () => confirm(SIGN_IN_QUESTION, true),
      ...(opts.home !== undefined ? { home: opts.home } : {}),
      apiUrl: (opts.baseUrl ?? nolaApiUrl()).replace(/\/$/, ""),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      interactive,
      note: print ? err : out,
      open: opts.open ?? openBrowser,
    });
  } catch (e) {
    err(
      e instanceof SignInRequiredError || e instanceof SignInUnavailableError || e instanceof SignInError
        ? e.message
        : `Could not get a Nola API key: ${e instanceof Error ? e.message : String(e)}`,
    );
    return 1;
  }

  if (print) {
    out(grant.apiKey);
    return 0;
  }

  out(grant.source === "trial" ? `New Nola account — ${grant.runs ?? 25} free runs.` : "Key minted on your Nola account.");
  out(`NOLA_API_KEY=${grant.apiKey}`);

  if (!interactive) {
    out(NOT_WRITTEN);
    return 0;
  }
  if ((await confirm(ADD_TO_ENV_QUESTION, true)) !== true) {
    out(NOT_WRITTEN);
    return 0;
  }
  const replace = (await hasEnvKey(cwd)) ? await confirm(REPLACE_ENV_QUESTION, false) : false;
  if (replace === null) {
    out(NOT_WRITTEN);
    return 0;
  }
  const result = await writeEnvKey(cwd, grant.apiKey, { replace });
  if (!result.wrote.includes(".env")) {
    // only reachable when the existing key was kept
    out(NOT_WRITTEN);
    return 0;
  }
  out(`${replace ? "Replaced in" : "Added to"} .env. Use it with \`model: "nola"\` in nola.config.ts.`);
  return 0;
}
