import { describe, expect, it } from "vitest";
import { openBrowser, openUrl, openWith, type Spawn } from "../src/open-url.js";

function recorder() {
  const calls: { cmd: string; args: readonly string[] | undefined }[] = [];
  const spawn = ((cmd: string, args?: readonly string[] | object) => {
    calls.push({ cmd, args: Array.isArray(args) ? args : undefined });
    return { on: () => undefined, unref: () => undefined };
  }) as unknown as Spawn;
  return { spawn, calls };
}

describe("openUrl", () => {
  const url = "https://nola.sh/billing/session/bill_1";

  it.each([
    ["win32", "cmd", ["/c", "start", "", url]],
    ["darwin", "open", [url]],
    ["linux", "xdg-open", [url]],
  ] as const)("%s → %s", (platform, cmd, args) => {
    const { spawn, calls } = recorder();
    expect(openUrl(url, platform, spawn)).toBe(true);
    expect(calls).toEqual([{ cmd, args }]);
  });

  it("win32 caret-escapes cmd's metacharacters so `start` gets the whole query string (a bare & ends the command)", () => {
    const { spawn, calls } = recorder();
    const authorize = "https://t.auth0.com/authorize?response_type=code&client_id=cli&redirect_uri=http%3A%2F%2F127.0.0.1%3A47831%2Fcallback&state=a|b";
    expect(openUrl(authorize, "win32", spawn)).toBe(true);
    expect(calls[0]?.args).toEqual(["/c", "start", "", "https://t.auth0.com/authorize?response_type=code^&client_id=cli^&redirect_uri=http%3A%2F%2F127.0.0.1%3A47831%2Fcallback^&state=a^|b"]);
    const { spawn: mac, calls: macCalls } = recorder();
    openUrl(authorize, "darwin", mac);
    expect(macCalls[0]?.args).toEqual([authorize]);
  });

  it("returns false when spawning throws (no opener installed)", () => {
    const spawn = (() => {
      throw new Error("ENOENT");
    }) as unknown as Spawn;
    expect(openUrl(url, "linux", spawn)).toBe(false);
  });
});

describe("openBrowser", () => {
  const url = "https://tenant.auth0.com/authorize?a=1&b=2";

  it("NOLA_NO_BROWSER wins; NOLA_BROWSER runs that command line with the URL appended, quoted, through the shell", () => {
    const { spawn, calls } = recorder();
    expect(openBrowser(url, { NOLA_NO_BROWSER: "1", NOLA_BROWSER: "firefox" }, spawn)).toBe(false);
    expect(calls).toEqual([]);
    expect(openBrowser(url, { NOLA_BROWSER: '"C:\\Program Files\\node.exe" browse.mjs' }, spawn)).toBe(true);
    expect(calls).toEqual([{ cmd: `"C:\\Program Files\\node.exe" browse.mjs "${url}"`, args: undefined }]);
  });

  it("without either variable the platform opener runs", () => {
    const { spawn, calls } = recorder();
    const plain = "https://platform.nola.sh/account"; // no cmd metacharacters, so the argument is the URL on every platform
    expect(openBrowser(plain, {}, spawn)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toContain(plain);
  });

  it("openWith returns false when the shell cannot be spawned", () => {
    const spawn = (() => {
      throw new Error("ENOENT");
    }) as unknown as Spawn;
    expect(openWith("firefox", url, spawn)).toBe(false);
  });
});
