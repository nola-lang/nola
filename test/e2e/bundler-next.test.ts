import { type ChildProcess, execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureBuilt, run } from "./helpers/ensure-built.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/next-app/", import.meta.url));

describe("next e2e", () => {
  beforeAll(() => ensureBuilt(ROOT), 600_000);

  it("next build (webpack mode) succeeds — transform + declarations + tsc all green", { timeout: 600_000 }, async () => {
    // async on purpose: a cold `next build` can exceed vitest's 60s worker RPC
    // timeout, and a synchronous wait would surface as an unhandled
    // "[vitest-worker]: Timeout calling onTaskUpdate" (see helpers/ensure-built.ts).
    await run("npx next build", FIXTURE, { ...process.env, CI: "1" });
  });

  it("next start serves the .tsi-backed route", { timeout: 240_000 }, async () => {
    const server = spawnServer(["next", "start", "-p", "43117"]);
    try {
      const answer = await fetchWithRetry("http://localhost:43117/api/greet", 60, 1000, server);
      expect(answer).toEqual({ answer: "hello Ada" });
    } finally {
      killTree(server.child);
    }
  });

  it("turbopack dev serves the route (runtime parity)", { timeout: 300_000 }, async () => {
    const server = spawnServer(["next", "dev", "--turbopack", "-p", "43118"]);
    try {
      const answer = await fetchWithRetry("http://localhost:43118/api/greet", 120, 1000, server);
      expect(answer).toEqual({ answer: "hello Ada" });
    } finally {
      killTree(server.child);
    }
  });
});

interface Server {
  child: ChildProcess;
  /** everything the server wrote so far (stdout + stderr, interleaved) */
  output(): string;
}

/** Spawn `npx <args>` in the fixture, capturing its output so a failure can show WHY the server 500'd. */
function spawnServer(args: string[]): Server {
  const child = spawn("npx", args, { cwd: FIXTURE, shell: true, stdio: ["ignore", "pipe", "pipe"] });
  const chunks: string[] = [];
  child.stdout?.on("data", (d: Buffer) => chunks.push(d.toString()));
  child.stderr?.on("data", (d: Buffer) => chunks.push(d.toString()));
  return { child, output: () => chunks.join("") };
}

/** Windows leaves the port bound on a plain kill — take the process tree down. */
function killTree(child: ChildProcess): void {
  if (process.platform === "win32" && child.pid !== undefined) {
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
    } catch {
      // already gone
    }
  } else {
    child.kill("SIGTERM");
  }
}

async function fetchWithRetry(url: string, attempts: number, delayMs: number, server: Server): Promise<unknown> {
  let lastErr: unknown;
  let lastBody = "";
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      lastBody = await res.text().catch(() => "");
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  const tail = (s: string, n: number) => (s.length > n ? `…${s.slice(-n)}` : s);
  throw new Error(
    `${String(lastErr)} from ${url}
--- response body ---
${tail(lastBody, 2000)}
--- server output ---
${tail(server.output(), 6000)}`,
  );
}
