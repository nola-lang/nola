import type { NolaHook, NolaLogLevel } from "@nola-lang/core";
import { redactSecrets } from "@nola-lang/core";
import { nolaRuntime } from "./runtime/index.js";

const LEVELS: readonly NolaLogLevel[] = ["silent", "error", "warn", "info", "debug"];
const rank = (level: NolaLogLevel): number => LEVELS.indexOf(level);

/** NOLA_LOG (when valid) overrides the configured level; default "warn". */
export function effectiveLogLevel(): NolaLogLevel {
  const configured = nolaRuntime.current().config?.observability.logLevel ?? "warn";
  const fromEnv = process.env.NOLA_LOG as NolaLogLevel | undefined;
  return fromEnv !== undefined && LEVELS.includes(fromEnv) ? fromEnv : configured;
}

const cache = new Map<NolaLogLevel, NolaHook>();

function make(level: NolaLogLevel): NolaHook {
  const enabled = (min: NolaLogLevel) => rank(level) >= rank(min);
  const line = (text: string) => redactSecrets(text);
  return {
    name: "nola:logger",
    onAskStart(e) {
      if (enabled("debug")) console.log(line(`[nola] ask ${e.site} via ${e.provider}`));
    },
    onProviderRequest(e) {
      // The composed prompt is only known here — askStart fires before composition.
      if (enabled("debug"))
        console.log(line(`[nola] request #${e.attempt} — ${e.messages.map((m) => m.content).join("\n")}`));
    },
    onProviderResponse(e) {
      if (enabled("debug")) console.log(line(`[nola] reply #${e.attempt} (${e.durationMs}ms) — ${e.text}`));
    },
    onValidationFailed(e) {
      if (enabled("warn"))
        console.warn(line(`[nola] ${e.site} validation failed on attempt ${e.attempt}: ${e.error}`));
    },
    onRetry(e) {
      if (enabled("warn")) console.warn(line(`[nola] ${e.site} retrying after attempt ${e.attempt}: ${e.reason}`));
    },
    onAskEnd(e) {
      const r = e.receipt;
      if (!r.outcome.ok) {
        if (enabled("error")) console.error(line(`[nola] ask ${r.site} failed — ${r.outcome.error}`));
        return;
      }
      if (enabled("info")) {
        console.log(
          line(`[nola] ask ${r.site} served by ${r.servedBy} in ${r.durationMs}ms (${r.attempts} attempt(s))`),
        );
      }
    },
  };
}

/** The always-registered logger hook, memoized per level. */
export function builtinLogger(): NolaHook {
  const level = effectiveLogLevel();
  let hook = cache.get(level);
  if (!hook) {
    hook = make(level);
    cache.set(level, hook);
  }
  return hook;
}
