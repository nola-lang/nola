import { describe, expect, it } from "vitest";
import { openUrl, type Spawn } from "../src/open-url.js";

function recorder() {
  const calls: { cmd: string; args: readonly string[] }[] = [];
  const spawn = ((cmd: string, args: readonly string[]) => {
    calls.push({ cmd, args });
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
  });

  it("returns false when spawning throws (no opener installed)", () => {
    const spawn = (() => {
      throw new Error("ENOENT");
    }) as unknown as Spawn;
    expect(openUrl(url, "linux", spawn)).toBe(false);
  });
});
