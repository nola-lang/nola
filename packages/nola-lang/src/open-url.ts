import { spawn as nodeSpawn } from "node:child_process";

export type Spawn = typeof nodeSpawn;

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
