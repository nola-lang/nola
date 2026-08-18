import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const LOCK_DIR = ".nola-e2e-build.lock";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Run a shell command to completion WITHOUT blocking the worker's event loop. */
export function run(command: string, cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, stdio: "inherit", env });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`\`${command}\` exited with ${signal ?? code} (cwd ${cwd})`));
    });
  });
}

/**
 * Serialize the e2e prebuild across parallel vitest worker processes: exactly
 * one worker runs `npm install && npm run build`; the others wait for the lock
 * to release and reuse that build. (A crashed builder leaves a stale lock —
 * the timeout below names it so it can be deleted by hand.)
 *
 * MUST stay async end to end. Vitest's worker↔main RPC (birpc) times out a
 * call after 60s on a plain setTimeout inside the worker; a worker that sits in
 * execSync/Atomics.wait for longer than that cannot process the reply, and
 * when it unblocks Node runs the timers phase first — so an `onTaskUpdate`
 * sent before the block surfaces as an unhandled "[vitest-worker]: Timeout
 * calling onTaskUpdate" even though the reply arrived. A cold CI build takes
 * minutes; a synchronous wait here reproduced exactly that.
 */
export async function ensureBuilt(root: string): Promise<void> {
  const lock = join(root, LOCK_DIR);
  try {
    mkdirSync(lock); // atomic acquire
  } catch {
    for (let i = 0; i < 1200; i++) {
      if (!existsSync(lock)) return; // released — that build is our build
      await sleep(500);
    }
    throw new Error(`timed out waiting for the e2e build lock (${lock}) — delete it if a previous run crashed`);
  }
  try {
    await run("npm install", root);
    await run("npm run build", root);
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
