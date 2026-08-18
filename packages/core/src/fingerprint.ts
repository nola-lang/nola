import { createHash } from "node:crypto";
import type { HistoryRecord, JsonSchema, Message, ProviderOutput, ProviderParams } from "./index.js";

/**
 * Version baked into every ask fingerprint. Bump when the canonical
 * serialization changes shape — old caches/ledgers must not silently match.
 * v3: fingerprintRequest hashes the full ProviderOutput (was bare schema) and
 * ProviderParams.
 */
export const FINGERPRINT_VERSION = 3;

function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) out[k] = sortValue((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

/** Deterministic JSON: recursively sorted object keys, arrays in order. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export interface AskFingerprintInput {
  lineage: ReadonlyArray<Readonly<Record<string, unknown>>>;
  history: ReadonlyArray<HistoryRecord>;
  prompt: string;
  schema: JsonSchema;
  provider: string;
  preamble: string;
}

/**
 * Everything that determines a provider exchange, nothing volatile (no askId,
 * no timestamps, no invocationId). History is hashed as the prompt sees it.
 */
export function fingerprintAsk(input: AskFingerprintInput): string {
  const payload = {
    v: FINGERPRINT_VERSION,
    lineage: input.lineage,
    history: input.history.map((h) => ({
      prompt: h.prompt,
      value: h.promptValue !== undefined ? h.promptValue : h.value,
    })),
    prompt: input.prompt,
    schema: input.schema,
    provider: input.provider,
    preamble: input.preamble,
  };
  return sha256Hex(canonicalize(payload));
}

/**
 * Fingerprint of exactly what crosses the NolaProvider.complete seam: the
 * system text plus what composeInferParams returned (messages + output
 * contract). Extra properties on `req` (e.g. a full ProviderRequest with its
 * signal) are ignored — only the three named fields are hashed.
 */
export function fingerprintRequest(req: {
  system: string;
  messages: ReadonlyArray<Message>;
  output: ProviderOutput;
  params?: ProviderParams;
}): string {
  return sha256Hex(
    canonicalize({
      v: FINGERPRINT_VERSION,
      system: req.system,
      messages: req.messages,
      output: req.output,
      params: req.params ?? null,
    }),
  );
}
