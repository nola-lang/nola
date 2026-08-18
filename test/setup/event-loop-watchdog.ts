// Diagnostic for "[vitest-worker]: Timeout calling onTaskUpdate".
//
// Vitest's worker↔main RPC (birpc) rejects a call after 60s on a plain
// setTimeout inside the worker. Any test that blocks the worker's event loop
// for longer than that — execSync, Atomics.wait, a big synchronous TypeScript
// program build — cannot receive the reply, and when it unblocks Node runs the
// timers phase first, so the stale timer fires as an unhandled error and the
// run exits 1 even though every test passed. Vitest does not say WHICH test
// stalled. This watchdog does: a 250ms interval measures how late it fires;
// a gap over STALL_MS is reported to stderr with the test that was running.
//
// Rule it enforces socially: e2e tests use the async helpers in
// test/e2e/helpers/ensure-built.ts (run/capture/shell), never the sync ones.
import { beforeEach } from "vitest";

const STALL_MS = Number(process.env.NOLA_WATCHDOG_STALL_MS ?? 30_000);
const TICK_MS = 250;

// The name is NOT cleared after a test: a starved interval only gets to run
// once the stall ends, i.e. after the blocking test has already finished.
let currentTest = "<before the first test>";
let last = Date.now();

beforeEach((ctx) => {
  currentTest = ctx.task.name;
});

const timer = setInterval(() => {
  const now = Date.now();
  const gap = now - last - TICK_MS;
  if (gap > STALL_MS) {
    process.stderr.write(
      `\n[event-loop-watchdog] worker event loop was blocked for ~${Math.round(gap / 1000)}s in/after "${currentTest}" ` +
        `(pid ${process.pid}) — a synchronous wait longer than vitest's 60s RPC timeout surfaces as ` +
        `"[vitest-worker]: Timeout calling onTaskUpdate"; make that test async.\n`,
    );
  }
  last = now;
}, TICK_MS);
timer.unref(); // never keep a worker alive on its own
