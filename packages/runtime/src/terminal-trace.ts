import { Codes } from "@nola-lang/ast";
import type { NolaIngestKind, NolaLogLevel, NolaTelemetry } from "@nola-lang/core";
import { ansiPalette, formatIngestLine, NolaConfigError, plainPalette } from "@nola-lang/core";
import { envelopeObserver } from "./ingest-envelope.js";

export const TERMINAL_TRACE = "nola:terminal";

export interface TerminalTraceOptions {
  /** `silent` · `error` · `warn` · `info` · `debug` (default). */
  level?: NolaLogLevel;
  /** Force colour on or off. Default: on when stderr is a TTY and `NO_COLOR` is unset. */
  color?: boolean;
}

const LEVELS: readonly NolaLogLevel[] = ["silent", "error", "warn", "info", "debug"];
const rank = (level: NolaLogLevel): number => LEVELS.indexOf(level);

/** The level at which each event kind first prints; a failed askEnd prints at `error`. */
const KIND_LEVEL: Record<NolaIngestKind, NolaLogLevel> = {
  askStart: "info",
  providerRequest: "debug",
  providerResponse: "debug",
  validationFailed: "warn",
  retry: "warn",
  askEnd: "info",
  invocationStart: "info",
  invocationEnd: "info",
};

/** picocolors' rule without the dependency: a TTY without NO_COLOR gets colour. */
function colorByDefault(): boolean {
  return process.stderr.isTTY === true && !process.env.NO_COLOR;
}

/**
 * The terminal sink (config v2 §4): the same envelopes the tracer posts,
 * rendered through core's `formatIngestLine` — the line `nola console`
 * prints for the same event, in the same colours on a TTY. Lines go to
 * STDERR, like every tracing tool's, so a program's stdout stays its own
 * (`nola run main.ts | jq` keeps working at any level).
 * `telemetry: { level }` means `terminalTrace({ level })`; an absent
 * `telemetry` means `terminalTrace()` — every event, at `debug`.
 */
export function terminalTrace(options: TerminalTraceOptions = {}): NolaTelemetry {
  const level = options.level ?? "debug";
  if (!LEVELS.includes(level)) {
    throw new NolaConfigError(`terminalTrace(): level must be one of ${LEVELS.join(", ")}.`, Codes.ConfigInvalid);
  }
  const palette = (options.color ?? colorByDefault()) ? ansiPalette : plainPalette;
  return envelopeObserver(TERMINAL_TRACE, (envelope) => {
    const failed =
      envelope.kind === "askEnd" &&
      (envelope.event as { receipt?: { outcome?: { ok?: boolean } } }).receipt?.outcome?.ok === false;
    const needed: NolaLogLevel = failed ? "error" : KIND_LEVEL[envelope.kind];
    if (rank(level) < rank(needed)) return;
    process.stderr.write(`${formatIngestLine(envelope, palette)}\n`);
  });
}
