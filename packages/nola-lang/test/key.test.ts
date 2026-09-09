import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SIGN_IN_QUESTION } from "create-nola-lang";
import { describe, expect, it } from "vitest";
import { ADD_TO_ENV_QUESTION, cmdKey, REPLACE_ENV_QUESTION } from "../src/key.js";
import { approvingBrowser, decliningBrowser } from "./login.test.js";

const tmp = (p = "nola-key-") => mkdtemp(join(tmpdir(), p));
const BASE = "https://api.nola.sh";
const KEY = `nola_sk_${"a".repeat(40)}`;
const KEY2 = `nola_sk_${"b".repeat(40)}`;
const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const AT = jwt({ sub: "auth0|1", "nola:account_id": "acct_u" });
const ID_TOKEN = `h.${Buffer.from(JSON.stringify({ email: "dev@example.com" })).toString("base64url")}.s`;
const CAPS = { protocol: 1, infer: true, ingest: false, auth: { issuer: BASE, clientId: "cli", audience: "aud", redirectPorts: [0] } };

type Reply = { status?: number; body?: unknown } | Error;
function stub(overrides: Record<string, Reply> = {}) {
  const calls: string[] = [];
  const fn = (async (url: unknown) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    const r = overrides[path];
    if (r instanceof Error) throw r;
    if (r) return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
    const defaults: Record<string, [number, unknown]> = {
      "/v1/trial": [201, { apiKey: KEY, account: { id: "acct_1", kind: "anonymous" }, trial: { runs: 25 } }],
      "/v1/capabilities": [200, CAPS],
      "/oauth/token": [200, { access_token: AT, refresh_token: "rt", expires_in: 3600, id_token: ID_TOKEN }],
      "/v1/console/keys": [201, { id: "key_2", name: "cli", prefix: "nola_sk_bb", suffix: "bbbbbbbb", apiKey: KEY2 }],
    };
    const d = defaults[path] ?? [404, { error: { code: "not_found", message: path } }];
    return new Response(JSON.stringify(d[1]), { status: d[0] });
  }) as typeof globalThis.fetch;
  return { fn, calls };
}

async function seedSession(home: string) {
  await mkdir(join(home, ".nola"), { recursive: true });
  await writeFile(
    join(home, ".nola", "credentials.json"),
    JSON.stringify({ version: 1, sessions: { [BASE]: { accessToken: AT, refreshToken: "rt", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), email: "dev@example.com" } } }),
  );
}
async function seedConfig(home: string) {
  await mkdir(join(home, ".nola"), { recursive: true });
  await writeFile(join(home, ".nola", "config.json"), JSON.stringify({ version: 1, accounts: { [BASE]: { accountId: "acct_old", issuedAt: "2026-09-01T08:00:00.000Z" } } }));
}

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, opts: { baseUrl: BASE, out: (l: string) => out.push(l), err: (l: string) => err.push(l), open: approvingBrowser() } };
}

/** A scripted confirm: answers in order, records `question|default`. */
function answers(script: (boolean | null)[]) {
  const asked: string[] = [];
  const queue = [...script];
  return {
    asked,
    confirm: async (q: string, initial: boolean) => {
      asked.push(`${q}|${initial}`);
      if (queue.length === 0) throw new Error(`unexpected question: ${q}`);
      return queue.shift() as boolean | null;
    },
  };
}

const NOT_WRITTEN = "Not written — add the line above to .env yourself.";

describe("nola key", () => {
  it("--print, signed in: stdout is the key alone, nothing on stderr, .env untouched", async () => {
    const home = await tmp();
    await seedSession(home);
    const cwd = await tmp();
    const { out, err, opts } = io();
    const { fn, calls } = stub();
    expect(await cmdKey({ ...opts, print: true, cwd, home, fetch: fn, interactive: true })).toBe(0);
    expect(out).toEqual([KEY2]);
    expect(err).toEqual([]);
    expect(calls).toEqual(["/v1/console/keys"]);
    expect(existsSync(join(cwd, ".env"))).toBe(false);
  });

  it("--print on a used machine: interactive signs in with the instructions on STDERR, stdout still the key alone; non-interactive exit 1", async () => {
    const home = await tmp();
    await seedConfig(home);
    const { out, err, opts } = io();
    const { fn, calls } = stub();
    const a = answers([true]);
    expect(await cmdKey({ ...opts, print: true, cwd: await tmp(), home, fetch: fn, interactive: true, confirm: a.confirm })).toBe(0);
    expect(a.asked).toEqual([`${SIGN_IN_QUESTION}|true`]);
    expect(out).toEqual([KEY2]);
    expect(err).toEqual([expect.stringMatching(/^Sign in to Nola: open https:\/\/api\.nola\.sh\/authorize\?/), "Waiting for the browser…", "Signed in as dev@example.com."]);
    expect(calls).toEqual(["/v1/capabilities", "/oauth/token", "/v1/console/keys"]);

    const home2 = await tmp();
    await seedConfig(home2);
    const b = io();
    const idle = stub();
    expect(await cmdKey({ ...b.opts, print: true, cwd: await tmp(), home: home2, fetch: idle.fn, interactive: false })).toBe(1);
    expect(b.out).toEqual([]);
    expect(b.err).toEqual(["This machine already used its 25 free Nola runs. Sign in with `npx nola-lang login` to get an API key for this project."]);
    expect(idle.calls).toEqual([]);
  });

  it("used machine, interactive: asks before opening the browser; no or Esc = the sign-in note on stderr, exit 1, browser never opened", async () => {
    for (const answer of [false, null]) {
      const home = await tmp();
      await seedConfig(home);
      const { out, err, opts } = io();
      const idle = stub();
      const opened: string[] = [];
      const a = answers([answer]);
      const code = await cmdKey({
        ...opts,
        cwd: await tmp(),
        home,
        fetch: idle.fn,
        interactive: true,
        confirm: a.confirm,
        open: (url) => {
          opened.push(url);
          return true;
        },
      });
      expect(code).toBe(1);
      expect(a.asked).toEqual([`${SIGN_IN_QUESTION}|true`]);
      expect(opened).toEqual([]);
      expect(idle.calls).toEqual([]);
      expect(out).toEqual([]);
      expect(err).toEqual(["This machine already used its 25 free Nola runs. Sign in with `npx nola-lang login` to get an API key for this project."]);
    }
  });

  it("fresh machine, yes: new-account line, the key line, written to .env — and ONLY .env", async () => {
    const home = await tmp();
    const cwd = await tmp();
    const { out, err, opts } = io();
    const { fn, calls } = stub();
    const a = answers([true]);
    expect(await cmdKey({ ...opts, cwd, home, fetch: fn, interactive: true, confirm: a.confirm })).toBe(0);
    expect(calls).toEqual(["/v1/trial"]);
    expect(a.asked).toEqual([`${ADD_TO_ENV_QUESTION}|true`]);
    expect(out).toEqual(["New Nola account — 25 free runs.", `NOLA_API_KEY=${KEY}`, "Added to .env."]);
    expect(err).toEqual([]);
    expect(await readFile(join(cwd, ".env"), "utf8")).toBe(`NOLA_API_KEY=${KEY}\n`);
    expect(existsSync(join(cwd, ".gitignore"))).toBe(false);
    expect(existsSync(join(home, ".nola", "credentials.json"))).toBe(false);
  });

  it("signed in: 'Key minted on your Nola account.'; no or Esc at 'Add it to .env?' leaves the hint; non-interactive never asks", async () => {
    const home = await tmp();
    await seedSession(home);
    for (const answer of [false, null]) {
      const cwd = await tmp();
      const { out, opts } = io();
      const a = answers([answer]);
      expect(await cmdKey({ ...opts, cwd, home, fetch: stub().fn, interactive: true, confirm: a.confirm })).toBe(0);
      expect(existsSync(join(cwd, ".env"))).toBe(false);
      expect(out).toEqual(["Key minted on your Nola account.", `NOLA_API_KEY=${KEY2}`, NOT_WRITTEN]);
    }
    const cwd = await tmp();
    const { out, opts } = io();
    const a = answers([]);
    expect(await cmdKey({ ...opts, cwd, home, fetch: stub().fn, interactive: false, confirm: a.confirm })).toBe(0);
    expect(a.asked).toEqual([]);
    expect(existsSync(join(cwd, ".env"))).toBe(false);
    expect(out.at(-1)).toBe(NOT_WRITTEN);
  });

  it("an existing key: asks to replace (default No); yes rewrites the line in place, no or Esc keeps it", async () => {
    const home = await tmp();
    await seedSession(home);
    const before = "OPENAI_API_KEY=sk-x\nexport NOLA_API_KEY=nola_sk_existing # old\nOTHER=1\n";
    for (const [second, expected] of [
      [true, `OPENAI_API_KEY=sk-x\nexport NOLA_API_KEY=${KEY2}\nOTHER=1\n`],
      [false, before],
      [null, before],
    ] as const) {
      const cwd = await tmp();
      await writeFile(join(cwd, ".env"), before);
      const { out, opts } = io();
      const a = answers([true, second]);
      expect(await cmdKey({ ...opts, cwd, home, fetch: stub().fn, interactive: true, confirm: a.confirm })).toBe(0);
      expect(a.asked).toEqual([`${ADD_TO_ENV_QUESTION}|true`, `${REPLACE_ENV_QUESTION}|false`]);
      expect(await readFile(join(cwd, ".env"), "utf8")).toBe(expected);
      expect(out.at(-1)).toBe(second === true ? "Replaced in .env." : NOT_WRITTEN);
    }
  });

  it("a failed mint is exit 1 with the API's message; sign-in failures carry the provider's message", async () => {
    const home = await tmp();
    await seedSession(home);
    const limit = io();
    expect(
      await cmdKey({
        ...limit.opts,
        cwd: await tmp(),
        home,
        fetch: stub({ "/v1/console/keys": { status: 409, body: { error: { code: "key_limit", message: "This account already has 10 live keys." } } } }).fn,
        interactive: false,
      }),
    ).toBe(1);
    expect(limit.err).toEqual(["Could not get a Nola API key: This account already has 10 live keys."]);

    const offline = io();
    expect(await cmdKey({ ...offline.opts, cwd: await tmp(), home, fetch: stub({ "/v1/console/keys": new Error("ENOTFOUND") }).fn, interactive: false })).toBe(1);
    expect(offline.err[0]).toMatch(/^Could not get a Nola API key: Could not reach the Nola API/);

    const home2 = await tmp();
    await seedConfig(home2);
    const denied = io();
    expect(
      await cmdKey({
        ...denied.opts,
        cwd: await tmp(),
        home: home2,
        fetch: stub().fn,
        open: decliningBrowser(),
        interactive: true,
        confirm: answers([true]).confirm, // yes to the sign-in question; the browser then declines
      }),
    ).toBe(1);
    expect(denied.err.at(-1)).toBe("Sign-in was declined in the browser.");
  });
});
