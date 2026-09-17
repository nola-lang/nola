import type { DefinitionSummary } from "./api";
import { formatDuration } from "./format";

/** NO-BREAK space: HTML collapses runs of ordinary spaces, which would undo the padding. */
const PAD = " ";

/** Widest usual values: `100` percent, and `240ms` / `12.3s` for a duration. A longer value simply takes more. */
const PCT_WIDTH = 3;
const DURATION_WIDTH = 5;

/**
 * A definition's one-line summary: `210 runs · 100% ok · avg 240ms · p95 388ms`.
 *
 * It is read while executions arrive, so it must hold still:
 *
 * - the ok share is of SETTLED executions (ok + error). `executions` counts
 *   one from the moment it starts, so ok / executions dipped below 100% for
 *   as long as anything was running and snapped back when it ended;
 * - every changing value is padded to a fixed width (the font is monospace),
 *   so a value getting shorter or longer does not move what follows it.
 */
export function defStatLine(d: DefinitionSummary): string {
  const settled = d.okCount + d.errorCount;
  const okPct = settled > 0 ? String(Math.round((d.okCount / settled) * 100)) : "—";
  const duration = (ms: number | undefined): string => formatDuration(ms).padStart(DURATION_WIDTH, PAD);
  return [
    `${d.executions} run${d.executions === 1 ? "" : "s"}`,
    `${okPct.padStart(PCT_WIDTH, PAD)}% ok`,
    `avg ${duration(d.avgDurationMs)}`,
    `p95 ${duration(d.p95DurationMs)}`,
  ].join(" · ");
}
