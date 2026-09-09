import { spawn as nodeSpawn } from "node:child_process";

export type Spawn = typeof nodeSpawn;

/**
 * The default opener for sign-in and account links. `NOLA_NO_BROWSER` (tests,
 * CI) opens nothing — the URL is always printed anyway. `NOLA_BROWSER` is a
 * shell command line the URL is appended to, quoted (`NOLA_BROWSER="firefox
 * --private-window"`, or a script that forwards the link somewhere else);
 * otherwise `openUrl`, the platform's default browser.
 */
export function openBrowser(url: string, env: NodeJS.ProcessEnv = process.env, spawn: Spawn = nodeSpawn): boolean {
  if (env.NOLA_NO_BROWSER) return false;
  const custom = env.NOLA_BROWSER?.trim();
  return custom ? openWith(custom, url, spawn) : openUrl(url, process.platform, spawn);
}

/** Run `<command> "<url>"` through the shell, detached, without waiting. False when the shell could not be spawned. */
export function openWith(command: string, url: string, spawn: Spawn = nodeSpawn): boolean {
  try {
    const child = spawn(`${command} ${JSON.stringify(url)}`, { detached: true, stdio: "ignore", shell: true });
    child.on("error", () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * `cmd /c` parses its command line: a bare `&` ends the command (`|`, `<`, `>`, `^`
 * likewise), so an /authorize URL would reach `start` cut at its first `&`. A caret
 * escapes each; `%` needs nothing (undefined %names% stay literal on a command line).
 */
const forCmd = (url: string) => url.replace(/[&|<>^]/g, "^$&");

/**
 * Open a URL in the user's default browser, detached, without waiting. Returns
 * false when the opener could not be spawned — callers always print the URL
 * too, so that is the fallback. (`cmd /c start "" <url>`: the empty string is
 * the window title `start` would otherwise steal from the first quoted arg.)
 */
export function openUrl(url: string, platform: NodeJS.Platform = process.platform, spawn: Spawn = nodeSpawn): boolean {
  const [cmd, args]: [string, string[]] =
    platform === "win32" ? ["cmd", ["/c", "start", "", forCmd(url)]] : platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}
