import type { NolaIngestEnvelope, NolaTelemetry } from "@nola-lang/core";
import { envelopeObserver } from "./ingest-envelope.js";
import { type PlatformOptions, resolvePlatformBaseUrl } from "./platform-model.js";

/** `nola.tracer()` target options: where envelopes go and how the transport authenticates; every field optional (baseUrl → NOLA_API_URL → api.nola.sh). */
export type TracerOptions = Pick<PlatformOptions, "baseUrl" | "apiKey" | "apiKeyEnv" | "fetch">;

const TRACE_TIMEOUT_MS = 1_500;

export const TRACER_HOOK = "nola:tracer";

function isLoopbackHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

/** The transport: one fire-and-forget POST /v1/ingest per envelope, warn once when unreachable, notice once off-loopback. */
function createTransport(options: TracerOptions): (envelope: NolaIngestEnvelope) => void {
  const doFetch = options.fetch ?? globalThis.fetch;
  let warned = false;
  let remoteNoticed = false;
  return (envelope) => {
    const baseUrl = resolvePlatformBaseUrl(options);
    if (!remoteNoticed && !isLoopbackHost(baseUrl)) {
      remoteNoticed = true;
      console.warn(`[nola] traces → ${baseUrl} — remove the tracer (or unset NOLA_TRACING_URL) to disable.`);
    }
    // Keyless on purpose: a loopback console needs no auth; send the key when we have one.
    const apiKey = options.apiKey ?? process.env[options.apiKeyEnv ?? "NOLA_API_KEY"];
    void doFetch(`${baseUrl}/v1/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(TRACE_TIMEOUT_MS),
    }).then(
      () => {},
      () => {
        if (warned) return;
        warned = true;
        console.warn(`[nola] console unreachable at ${baseUrl} — traces may be incomplete.`);
      },
    );
  };
}

/**
 * A trace destination as an observer (config v2 §5): `telemetry:
 * [nola.tracer()]`. Listed means sends — never gated on the server's
 * capabilities; an empty or absent target is the default URL rule.
 */
export function tracer(target: string | TracerOptions = {}): NolaTelemetry {
  const options: TracerOptions = typeof target === "string" ? { baseUrl: target } : target;
  return envelopeObserver(TRACER_HOOK, createTransport(options));
}
