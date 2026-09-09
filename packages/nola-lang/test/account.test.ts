import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cmdAccount, formatPrice, NOT_SIGNED_IN } from "../src/account.js";
import { approvingBrowser, stub } from "./login.test.js";

const tmp = () => mkdtemp(join(tmpdir(), "nola-account-"));
const BASE = "https://api.nola.sh";
const KEY = `nola_sk_${"a".repeat(40)}`;
const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const AT = jwt({ sub: "auth0|1", "nola:account_id": "acct_u" });

async function seedSession(home: string, accessToken = AT, expiresInMs = 3_600_000) {
  await mkdir(join(home, ".nola"), { recursive: true });
  await writeFile(
    join(home, ".nola", "credentials.json"),
    JSON.stringify({
      version: 1,
      sessions: { [BASE]: { accessToken, refreshToken: "rt", expiresAt: new Date(Date.now() + expiresInMs).toISOString(), email: "dev@example.com" } },
    }),
  );
}

function io(home: string, interactive = false) {
  const out: string[] = [];
  const err: string[] = [];
  const opened: string[] = [];
  return {
    out,
    err,
    opened,
    opts: {
      baseUrl: BASE,
      home,
      interactive,
      out: (l: string) => out.push(l),
      err: (l: string) => err.push(l),
      open: approvingBrowser(opened),
    },
  };
}

describe("nola account", () => {
  it("signed in, from anywhere: account line, balance, early-access note, opens <consoleUrl>/account — exit 0", async () => {
    const home = await tmp();
    await seedSession(home);
    const { fn, calls } = stub();
    const { out, opened, opts } = io(home);
    expect(await cmdAccount({ ...opts, cwd: await tmp(), fetch: fn })).toBe(0);
    expect(calls.map((c) => c.path)).toEqual(["/v1/console/me", "/v1/capabilities"]);
    expect(calls[0]?.authorization).toBe(`Bearer ${AT}`);
    expect(out).toEqual([
      "Nola account: dev@example.com — 3 / 25 free runs used",
      "Balance  $7.84",
      "",
      "Early access: The hosted Nola inference service is designed to help you get started quickly. For now, we recommend it for prototyping and development rather than production use.",
      "",
      "Opening https://platform.nola.sh/account",
      "If your browser did not open, visit the link above.",
    ]);
    expect(opened).toEqual(["https://platform.nola.sh/account"]);
    expect(out.join("\n")).not.toContain(AT);
  });

  it("inside a project with a key: the account is claimed first and the outcome noted", async () => {
    const home = await tmp();
    await seedSession(home);
    const cwd = await tmp();
    await writeFile(join(cwd, ".env"), `NOLA_API_KEY=${KEY}\n`);
    const { fn, calls } = stub();
    const { out, opts } = io(home);
    expect(await cmdAccount({ ...opts, cwd, fetch: fn })).toBe(0);
    expect(calls.slice(0, 2).map((c) => c.path)).toEqual(["/v1/billing/session", "/v1/console/sessions/bill_1/claim"]);
    expect(calls[0]?.authorization).toBe(`Bearer ${KEY}`);
    expect(out[0]).toBe("Linked this project's trial account to your Nola account.");
  });

  it("not signed in: non-interactive exit 1 naming nola login; interactive runs the browser sign-in, then continues", async () => {
    const home = await tmp();
    const idle = stub();
    const a = io(home);
    expect(await cmdAccount({ ...a.opts, cwd: await tmp(), fetch: idle.fn })).toBe(1);
    expect(a.err).toEqual([NOT_SIGNED_IN]);
    expect(idle.calls).toEqual([]);

    const { fn, calls } = stub();
    const b = io(home, true);
    expect(await cmdAccount({ ...b.opts, cwd: await tmp(), fetch: fn })).toBe(0);
    expect(calls.map((c) => c.path)).toEqual(["/v1/capabilities", "/oauth/token", "/v1/console/me", "/v1/capabilities"]);
    expect(b.out[2]).toBe("Signed in as dev@example.com.");
    expect(b.opened).toEqual([expect.stringMatching(/^https:\/\/api\.nola\.sh\/authorize\?/), "https://platform.nola.sh/account"]);
    expect((JSON.parse(await readFile(join(home, ".nola", "credentials.json"), "utf8")) as { sessions: Record<string, unknown> }).sessions[BASE]).toBeDefined();
  });

  it("a stale session is refreshed first; a session the API rejects is forgotten with a sign-in hint (exit 1)", async () => {
    const home = await tmp();
    await seedSession(home, "old", 10_000);
    const { fn, calls } = stub({ "/oauth/token": { body: { access_token: "fresh", refresh_token: "rt2", expires_in: 3600 } } });
    const a = io(home);
    expect(await cmdAccount({ ...a.opts, cwd: await tmp(), fetch: fn })).toBe(0);
    expect(calls.map((c) => c.path)).toEqual(["/v1/capabilities", "/oauth/token", "/v1/console/me", "/v1/capabilities"]);
    expect(calls[2]?.authorization).toBe("Bearer fresh");

    const home2 = await tmp();
    await seedSession(home2);
    const rejected = stub({ "/v1/console/me": { status: 401, body: { error: { code: "unauthorized", message: "Your session is not valid. Sign in again." } } } });
    const b = io(home2);
    expect(await cmdAccount({ ...b.opts, cwd: await tmp(), fetch: rejected.fn })).toBe(1);
    expect(b.err).toEqual(["Your Nola session is no longer valid. Run `npx nola-lang login` to sign in again."]);
    expect((JSON.parse(await readFile(join(home2, ".nola", "credentials.json"), "utf8")) as { sessions: Record<string, unknown> }).sessions).toEqual({});

    // account-claim-required: a 403 account_mismatch (stale claim after a wipe) is handled the same way
    const home3 = await tmp();
    await seedSession(home3);
    const stale = stub({ "/v1/console/me": { status: 403, body: { error: { code: "account_mismatch", message: "Sign in again." } } } });
    const c = io(home3);
    expect(await cmdAccount({ ...c.opts, cwd: await tmp(), fetch: stale.fn })).toBe(1);
    expect(c.err).toEqual(["Your Nola session is no longer valid. Run `npx nola-lang login` to sign in again."]);
    expect((JSON.parse(await readFile(join(home3, ".nola", "credentials.json"), "utf8")) as { sessions: Record<string, unknown> }).sessions).toEqual({});
  });

  it("exit 1 when the API cannot be reached or the console API is off (404)", async () => {
    const home = await tmp();
    await seedSession(home);
    const offline = stub({ "/v1/console/me": new Error("ENOTFOUND") });
    const a = io(home);
    expect(await cmdAccount({ ...a.opts, cwd: await tmp(), fetch: offline.fn })).toBe(1);
    expect(a.err[0]).toMatch(/^Could not read the Nola account: Could not reach the Nola API/);
    const off = stub({ "/v1/console/me": { status: 404, body: { error: { code: "not_found", message: "No route for GET /v1/console/me" } } } });
    const b = io(home);
    expect(await cmdAccount({ ...b.opts, cwd: await tmp(), fetch: off.fn })).toBe(1);
    expect(b.err[0]).toBe("Could not read the Nola account: No route for GET /v1/console/me");
  });

  it("keeps a sub-cent price's third decimal and never pads a whole one past two", () => {
    expect(formatPrice(250_000)).toBe("$0.25");
    expect(formatPrice(35_000)).toBe("$0.035");
    expect(formatPrice(1_000_000)).toBe("$1.00");
  });
});
