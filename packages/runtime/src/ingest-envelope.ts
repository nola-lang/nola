import type { NolaIngestEnvelope, NolaIngestKind, NolaTelemetry } from "@nola-lang/core";
import { NOLA_INGEST_VERSION, redactSecrets } from "@nola-lang/core";
import { nolaRuntime } from "./runtime/index.js";

/**
 * Every observer event becomes one kind-discriminated envelope — the shape
 * the console ingests and the terminal prints (config v2 §4). Redaction is
 * sender-side and fingerprint-preserving; the project name is read from the
 * latched config at send time (an observer is constructed before the config
 * is resolved). A throwing `send` is swallowed: observing never breaks the
 * ask path.
 */
export function envelopeObserver(name: string, send: (envelope: NolaIngestEnvelope) => void): NolaTelemetry {
  const runId = crypto.randomUUID();
  let seq = 0;
  const emit = (kind: NolaIngestKind, event: unknown): void => {
    const project = nolaRuntime.current().config?.project;
    const envelope: NolaIngestEnvelope = {
      v: NOLA_INGEST_VERSION,
      runId,
      pid: process.pid,
      ...(project !== undefined ? { project } : {}),
      seq: seq++,
      at: Date.now(),
      kind,
      event,
    };
    // Redact every string field EXCEPT identity hashes: redactSecrets eats
    // 32+-char hex runs, and both the receipt fingerprint and the def stamp
    // are 64-char sha256 hex (redacting def would collapse every ask into
    // ONE definition).
    const redacted = JSON.parse(
      JSON.stringify(envelope, (key, value) =>
        typeof value === "string" && key !== "fingerprint" && key !== "def" ? redactSecrets(value) : value,
      ),
    ) as NolaIngestEnvelope;
    try {
      send(redacted);
    } catch {
      // fire-and-forget: a broken transport must not surface here
    }
  };
  return {
    name,
    onAskStart: (e) => emit("askStart", e),
    onProviderRequest: (e) => emit("providerRequest", e),
    onProviderResponse: (e) => emit("providerResponse", e),
    onValidationFailed: (e) => emit("validationFailed", e),
    onRetry: (e) => emit("retry", e),
    onAskEnd: (e) => emit("askEnd", e),
    onInvocationStart: (e) => emit("invocationStart", e),
    onInvocationEnd: (e) => emit("invocationEnd", e),
  };
}
