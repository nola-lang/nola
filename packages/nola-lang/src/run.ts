import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { registerNola } from "@nola-lang/node-loader";

/**
 * How long a CRASHED program's event loop gets to drain before `nola run`
 * exits 1: enough for the tracer's in-flight POSTs (1.5 s timeout each) to
 * settle, short enough that a program which also left a server open still
 * ends about when node would have ended it.
 */
const CRASH_DRAIN_GRACE_MS = 2_000;

/**
 * Resolves when the event loop drains (`beforeExit`) — with `graceMs`, at the
 * latest after that long. The grace timer is unref'd, so it never keeps the
 * loop alive itself: a loop with nothing else pending drains at once.
 */
function drained(graceMs?: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    const done = (): void => {
      process.off("beforeExit", done);
      clearTimeout(timer);
      resolve();
    };
    process.once("beforeExit", done);
    if (graceMs !== undefined) timer = setTimeout(done, graceMs).unref();
  });
}

export async function cmdRun(entryArg: string): Promise<number> {
  if (!entryArg) {
    console.error("nola run <entry>");
    return 1;
  }
  const entry = resolve(entryArg);
  await registerNola({ dir: dirname(entry) });
  // The entry has evaluated, but the program may not be over: a timer, a
  // server, the tracer's in-flight POSTs keep the event loop alive exactly as
  // they do under `node --import nola-lang/register`, and the dispatcher's
  // process.exit would cut them short — the console showed a run's last ask
  // as running forever because its askEnd envelope never left the process.
  // So return only once the loop drains; a program that never lets it drain
  // keeps `nola run` alive the way it keeps node alive.
  try {
    await import(pathToFileURL(entry).href);
  } catch (error) {
    // Node exits the moment a top-level rejection goes uncaught, and would
    // take the failed ask's askEnd — the one event a console exists to show —
    // with it. A crashed program gets a bounded drain instead: with only those
    // POSTs pending it is over in milliseconds, a server it left open costs
    // the grace period, then the error surfaces as before.
    await drained(CRASH_DRAIN_GRACE_MS);
    throw error;
  }
  await drained();
  return typeof process.exitCode === "number" ? process.exitCode : 0;
}
