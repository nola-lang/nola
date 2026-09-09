import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { capture, ensureBuilt } from "./helpers/ensure-built.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CREATE = join(ROOT, "packages", "create-nola-lang", "dist", "main.js");
const NOLA = join(ROOT, "packages", "nola-lang", "dist", "main.js");

/** Workspace-link the runtime packages the scaffolded app depends on. */
function linkDeps(app: string): void {
  const scope = join(app, "node_modules", "@nola-lang");
  mkdirSync(scope, { recursive: true });
  for (const pkg of ["runtime", "providers"]) {
    symlinkSync(join(ROOT, "packages", pkg), join(scope, pkg), "junction");
  }
}

function run(cmd: string[], cwd: string): Promise<string> {
  return capture(process.execPath, cmd, { cwd });
}

// The launch requirement: a scaffolded project's first `nola run` succeeds
// OFFLINE — answers come from the committed replay ledger, no API key. This
// doubles as a prompt-composition stability guard: wording changes re-key the
// ledger and fail here until the template ledger is re-recorded.
describe("scaffolded project", () => {
  let app: string;

  beforeAll(async () => {
    await ensureBuilt(ROOT);
    const parent = await mkdtemp(join(tmpdir(), "nola-scaffold-e2e-"));
    app = join(parent, "my-app");
    await run([CREATE, app], parent);
    linkDeps(app);
  }, 600_000);

  it("nola run works keylessly via the replay ledger", async () => {
    const out = await run([NOLA, "run", "src/main.ts"], app);
    const lastLine = out.trim().split("\n").at(-1) as string;
    expect(JSON.parse(lastLine)).toEqual({
      name: "Alice Smith",
      age: 32,
      employer: "Acme Corp",
      job: "staff engineer",
    });
  });

  it("nola check passes", async () => {
    const out = await run([NOLA, "check"], app);
    expect(out).toContain("no errors");
  });

  it("nola init lays down the identical starter", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "nola-init-e2e-")), "app2");
    await run([NOLA, "init", dir], ROOT);
    for (const f of ["package.json", "nola.config.ts", "nola.replay.jsonl", ".gitignore", "src/person.tsi", "src/main.ts"]) {
      expect(existsSync(join(dir, f)), f).toBe(true);
    }
  });

  it("scaffolds the empty template and checks clean", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "nola-empty-e2e-")), "app");
    await run([CREATE, dir, "--template", "empty", "--ide", "vscode", "--agents", "all"], ROOT);
    for (const f of ["package.json", "tsconfig.json", "nola.config.ts", ".gitignore", "src/main.ts"]) {
      expect(existsSync(join(dir, f)), f).toBe(true);
    }
    expect(existsSync(join(dir, "nola.replay.jsonl"))).toBe(false);
    for (const f of [".vscode/launch.json", ".vscode/extensions.json"]) {
      expect(existsSync(join(dir, f)), f).toBe(true);
    }
    const launch = JSON.parse(readFileSync(join(dir, ".vscode", "launch.json"), "utf8"));
    expect(launch.configurations[0].runtimeArgs).toContain("nola-lang/register");
    for (const f of [
      ".claude/skills/nola/SKILL.md",
      ".cursor/rules/nola.mdc",
      ".github/instructions/nola.instructions.md",
      "AGENTS.md",
    ]) {
      expect(existsSync(join(dir, f)), f).toBe(true);
    }
    // Adapters are self-contained copies, never pointers into node_modules.
    const agentsMd = readFileSync(join(dir, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("Where Nola diverges from TypeScript");
    expect(agentsMd).toContain("<!-- nola-skill v");
    expect(agentsMd).not.toContain("node_modules/nola-lang/skills");
    for (const ref of ["syntax.md", "patterns.md", "config.md", "pitfalls.md"]) {
      expect(existsSync(join(dir, ".claude", "skills", "nola", "references", ref)), ref).toBe(true);
    }
    linkDeps(dir);
    const out = await run([NOLA, "check"], dir);
    expect(out).toContain("no errors");
  });

  it("scaffolds an example template from the dev checkout, no network", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "nola-example-e2e-")), "app");
    await run([NOLA, "init", dir, "--template", "extract-resume"], ROOT);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(pkg.name).toBe("app");
    expect(pkg.dependencies["@nola-lang/runtime"]).toMatch(/^\^0\./);
    linkDeps(dir);
    const out = await run([NOLA, "run", "src/main.ts"], dir);
    expect(JSON.parse(out.trim())).toEqual({
      name: "Grace Hopper",
      email: "grace@example.com",
      experience: ["United States Navy programmer (1943-1966)", "Eckert-Mauchly, worked on UNIVAC I (1949-1954)"],
      skills: ["COBOL", "compilers"],
      education: [{ school: "Yale University", degree: "PhD in Mathematics", year: 1934 }],
    });
  });

  it("adds Nola to an existing project (nola init --add), idempotently", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-add-e2e-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "existing-api", private: true, type: "module" }, null, 2));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "util.ts"), "export const answer = 42;\n");
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            strict: true,
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            allowArbitraryExtensions: true,
            noEmit: true,
            skipLibCheck: true,
          },
          include: ["src"],
        },
        null,
        2,
      ),
    );
    const out1 = await run([NOLA, "init", dir, "--add", "--ide", "vscode"], ROOT);
    expect(out1).toContain("Added Nola");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(pkg.name).toBe("existing-api");
    expect(pkg.dependencies["@nola-lang/runtime"]).toMatch(/^\^0\./);
    expect(pkg.devDependencies.typescript).toBe("^5.6.0");
    expect(existsSync(join(dir, ".vscode", "extensions.json"))).toBe(true);
    linkDeps(dir);
    const check = await run([NOLA, "check"], dir);
    expect(check).toContain("no errors");
    const again = await run([NOLA, "init", dir, "--add"], ROOT);
    expect(again).toContain("already has Nola");
  });

  it("nola skill install writes adapters into an existing project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-skill-e2e-"));
    writeFileSync(join(dir, "package.json"), '{"name":"existing"}\n');
    const out = await run([NOLA, "skill", "install", "--agents", "agents-md,claude"], dir);
    expect(out).toContain("Installed agent skill files");
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "skills", "nola", "SKILL.md"))).toBe(true);
    // idempotent second run: same version, so nothing is rewritten
    const again = await run([NOLA, "skill", "install", "--agents", "agents-md,claude"], dir);
    expect(again).toContain("already exists");
    expect(again).toContain("is up to date");

    // a stale stamp is held back until --force
    const rule = join(dir, ".cursor", "rules", "nola.mdc");
    mkdirSync(join(dir, ".cursor", "rules"), { recursive: true });
    writeFileSync(rule, "<!-- nola-skill v0.0.1 -->\nstale\n");
    const held = await run([NOLA, "skill", "install", "--agents", "cursor"], dir);
    expect(held).toContain("--force");
    expect(readFileSync(rule, "utf8")).toContain("stale");
    const forced = await run([NOLA, "skill", "install", "--agents", "cursor", "--force"], dir);
    expect(forced).toContain("Installed agent skill files");
    expect(readFileSync(rule, "utf8")).toContain("Where Nola diverges from TypeScript");
  });

  it("trial → sign-in journey against a local stub (API + tenant): one anonymous trial per machine, then account keys", async () => {
    const KEY = `nola_sk_${"e".repeat(40)}`;
    const KEY2 = `nola_sk_${"f".repeat(40)}`;
    const KEY3 = `nola_sk_${"9".repeat(40)}`;
    const ACCOUNT_KEYS = [KEY2, KEY3];
    // JWT-shaped with the account claim: the CLI refuses a sign-in whose token the tenant's Action did not stamp
    const AT = `h.${Buffer.from(JSON.stringify({ sub: "auth0|e2e", "nola:account_id": "acct_user" })).toString("base64url")}.e2e`;
    const ID_TOKEN = `h.${Buffer.from(JSON.stringify({ email: "e2e@example.com" })).toString("base64url")}.s`;
    const inferBodies: Record<string, unknown>[] = [];
    const trialBodies: string[] = [];
    const consoleKeyAuth: (string | undefined)[] = [];
    const claims: { session: string; auth: string | undefined }[] = [];
    const authorizeQueries: Record<string, string>[] = [];
    let apiUrl = "";
    const readBody = (req: IncomingMessage) =>
      new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (c) => {
          data += c;
        });
        req.on("end", () => resolve(data));
      });
    const json = (res: import("node:http").ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    const server: Server = createServer(async (req, res) => {
      const body = await readBody(req);
      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (req.method === "POST" && path === "/v1/trial") {
        trialBodies.push(body);
        return json(res, 201, { apiKey: KEY, account: { id: "acct_e2e", kind: "anonymous" }, trial: { runs: 25 } });
      }
      if (req.method === "GET" && path === "/v1/capabilities") {
        return json(res, 200, { protocol: 1, infer: true, ingest: false, auth: { issuer: apiUrl, clientId: "cli", audience: "aud", redirectPorts: [0] }, consoleUrl: "https://console.test" });
      }
      if (req.method === "GET" && path === "/authorize") {
        // the "tenant" approves at once: straight back to the CLI's loopback callback, as Auth0 would after the consent page
        const q = new URL(req.url ?? "/", "http://x").searchParams;
        authorizeQueries.push(Object.fromEntries(q));
        res.writeHead(302, { location: `${q.get("redirect_uri")}?code=e2e-code&state=${q.get("state")}` });
        res.end();
        return;
      }
      if (req.method === "POST" && path === "/oauth/token") {
        return json(res, 200, { access_token: AT, refresh_token: "e2e-refresh", expires_in: 3600, id_token: ID_TOKEN, token_type: "Bearer" });
      }
      if (req.method === "POST" && path === "/v1/console/keys") {
        consoleKeyAuth.push(req.headers.authorization);
        if (req.headers.authorization !== `Bearer ${AT}`) return json(res, 401, { error: { code: "unauthorized", message: "Sign in to the console to use this endpoint." } });
        const apiKey = ACCOUNT_KEYS[consoleKeyAuth.length - 1] ?? KEY3;
        return json(res, 201, { id: `key_${consoleKeyAuth.length}`, name: "cli", prefix: apiKey.slice(0, 10), suffix: apiKey.slice(-8), apiKey });
      }
      if (req.method === "POST" && path === "/v1/billing/session") {
        return json(res, 201, { url: `https://console.test/billing?session=bill_${req.headers.authorization?.slice(-4)}`, expiresAt: new Date(Date.now() + 900_000).toISOString() });
      }
      const claim = /^\/v1\/console\/sessions\/([^/]+)\/claim$/.exec(path);
      if (req.method === "POST" && claim) {
        claims.push({ session: claim[1] as string, auth: req.headers.authorization });
        return json(res, 200, { outcome: claims.length === 1 ? "claimed" : "already_owned", accountId: "acct_user" });
      }
      if (req.method === "GET" && path === "/v1/console/me") {
        return json(res, 200, {
          user: { id: "usr_e2e", email: "e2e@example.com", name: null, avatarUrl: null },
          account: { id: "acct_user", kind: "user", status: "active", mode: "trial", trial: { runsUsed: 1, runsLimit: 25 }, balanceMicro: 0, spendThisMonthMicro: 0, liveKeyCount: 3 },
        });
      }
      if (req.method === "POST" && path === "/v1/infer") {
        if (![KEY, KEY2, KEY3].map((k) => `Bearer ${k}`).includes(req.headers.authorization ?? "")) {
          return json(res, 401, { error: { code: "unauthorized", message: "bad key" } });
        }
        inferBodies.push(JSON.parse(body));
        return json(
          res,
          200,
          { text: JSON.stringify({ name: "Alice Smith", age: 32, employer: "Acme Corp", job: "staff engineer" }), durationMs: 1 },
          { "x-nola-runs-used": "1", "x-nola-runs-limit": "25" },
        );
      }
      json(res, 404, { error: { code: "not_found", message: `no route ${req.method} ${path}` } });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const home = await mkdtemp(join(tmpdir(), "nola-trial-home-"));
      // the "browser": a node script that follows the authorize link (the stub 302s it to the CLI's callback)
      const browser = join(home, "browser.mjs");
      writeFileSync(browser, "await fetch(process.argv[2]).then((r) => r.text()).catch(() => undefined);\n");
      const env = { ...process.env, NOLA_API_URL: apiUrl, HOME: home, USERPROFILE: home, NOLA_BROWSER: `"${process.execPath}" "${browser}"` };
      const parent = await mkdtemp(join(tmpdir(), "nola-trial-e2e-"));

      // 1. First scaffold: the machine's one anonymous trial — key in .env, account in config.json, NO credentials file.
      const dir = join(parent, "trial-app");
      await capture(process.execPath, [CREATE, dir, "--trial"], { cwd: parent, env });
      expect(readFileSync(join(dir, ".env"), "utf8")).toBe(`NOLA_API_KEY=${KEY}\n`);
      expect(readFileSync(join(dir, ".gitignore"), "utf8").split("\n")).toEqual(expect.arrayContaining([".env", ".env.*"]));
      expect(readFileSync(join(dir, "nola.config.ts"), "utf8")).toBe(
        readFileSync(join(ROOT, "packages", "create-nola-lang", "templates", "_providers", "nola.config.ts"), "utf8"),
      );
      expect(existsSync(join(dir, "nola.replay.jsonl"))).toBe(false);
      // Spec 2026-09-02 §6.1: nothing on the machine identifies it to the server…
      expect(trialBodies.map((b) => JSON.parse(b))).toEqual([{}]);
      // …and the granted account is recorded, credential-free.
      expect(JSON.parse(readFileSync(join(home, ".nola", "config.json"), "utf8"))).toEqual({
        version: 1,
        accounts: { [apiUrl]: { accountId: "acct_e2e", issuedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/) } },
      });
      expect(existsSync(join(home, ".nola", "credentials.json"))).toBe(false);

      linkDeps(dir);
      const out = await capture(process.execPath, [NOLA, "run", "src/main.ts"], { cwd: dir, env });
      expect(JSON.parse(out.trim().split("\n").at(-1) as string)).toEqual({
        name: "Alice Smith",
        age: 32,
        employer: "Acme Corp",
        job: "staff engineer",
      });
      expect(inferBodies).toHaveLength(1);
      expect(inferBodies[0]).not.toHaveProperty("model");
      expect((inferBodies[0]?.intent as { intent: string }).intent).toBe("extract");
      const check = await run([NOLA, "check"], dir);
      expect(check).toContain("no errors");

      // 2. Second scaffold, non-interactive: the trial is used up here — no key, the sign-in note, the offline template.
      const dir2 = join(parent, "trial-app-2");
      const out2 = await capture(process.execPath, [CREATE, dir2, "--trial"], { cwd: parent, env });
      expect(out2).toContain("This machine already used its 25 free Nola runs. Sign in with `npx nola-lang login`");
      expect(existsSync(join(dir2, ".env"))).toBe(false);
      expect(existsSync(join(dir2, "nola.replay.jsonl"))).toBe(true);
      expect(trialBodies).toHaveLength(1);

      // 3. nola login inside project 1: PKCE in the "browser" (the stub 302s straight back), the trial account rode /authorize as the hint,
      //    session stored, project 1's account claimed by its key.
      const login = await capture(process.execPath, [NOLA, "login"], { cwd: dir, env });
      expect(login).toContain(`Sign in to Nola: open ${apiUrl}/authorize?`);
      expect(authorizeQueries).toEqual([
        expect.objectContaining({ response_type: "code", client_id: "cli", audience: "aud", code_challenge_method: "S256", "ext-nola_account": "acct_e2e" }),
      ]);
      expect(login).toContain("Signed in as e2e@example.com.");
      expect(login).toContain("Linked this project's trial account to your Nola account.");
      expect(claims).toEqual([{ session: `bill_${KEY.slice(-4)}`, auth: `Bearer ${AT}` }]);
      const credentials = JSON.parse(readFileSync(join(home, ".nola", "credentials.json"), "utf8"));
      expect(credentials).toEqual({
        version: 1,
        sessions: { [apiUrl]: { accessToken: AT, refreshToken: "e2e-refresh", expiresAt: expect.stringMatching(/Z$/), email: "e2e@example.com" } },
      });
      expect(login).not.toContain(AT);

      // 4. Third scaffold: signed in — the key comes from the account, not a trial.
      const dir3 = join(parent, "trial-app-3");
      const out3 = await capture(process.execPath, [CREATE, dir3, "--trial", "--template", "empty"], { cwd: parent, env });
      expect(out3).toContain("# key in .env (run `npx nola-lang account` to check the balance)");
      expect(readFileSync(join(dir3, ".env"), "utf8")).toBe(`NOLA_API_KEY=${KEY2}\n`);
      expect(consoleKeyAuth).toEqual([`Bearer ${AT}`]);
      expect(trialBodies).toHaveLength(1);

      // 5. nola key --print: stdout is the next account key and nothing else.
      const printed = await capture(process.execPath, [NOLA, "key", "--print"], { cwd: dir3, env });
      expect(printed).toBe(`${KEY3}\n`);
      expect(consoleKeyAuth).toHaveLength(2);

      // 6. nola account from project 3: claims its key (already ours), prints the account, opens the console's account page.
      const account = await capture(process.execPath, [NOLA, "account"], { cwd: dir3, env });
      expect(account).toContain("This project's account is already yours.");
      expect(account).toContain("Nola account: e2e@example.com — 1 / 25 free runs used");
      expect(account).toContain("Opening https://console.test/account");
      expect(claims).toHaveLength(2);
      expect(account).not.toContain(AT);

      // 7. nola logout forgets the session; a later --trial scaffold is back to "sign in".
      expect(await capture(process.execPath, [NOLA, "logout"], { cwd: parent, env })).toContain("Signed out of Nola.");
      expect(JSON.parse(readFileSync(join(home, ".nola", "credentials.json"), "utf8")).sessions).toEqual({});
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 180_000);
});
