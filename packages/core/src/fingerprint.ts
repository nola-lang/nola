import { createHash } from "node:crypto";
import type { ProviderParams } from "./index.js";
import type { InferenceModel } from "./inference-model.js";

/**
 * Version baked into every ask fingerprint. Bump when the canonical
 * serialization changes shape — old caches/ledgers must not silently match.
 * v6 (prompt-rendering spec 2026-09-28): the fingerprint is taken over the
 * INTENT — the ask as data, correction stripped — plus ProviderParams and the
 * profile. Rendering is the provider's concern and never part of the identity,
 * so a Nola release that rephrases the default prompt keeps every ledger.
 */
export const FINGERPRINT_VERSION = 6;

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

/** The intent as first composed: the correction turn is not identity. */
function firstComposed(intent: InferenceModel): Omit<InferenceModel, "correction"> {
  const { correction: _correction, ...rest } = intent;
  return rest;
}

/**
 * Fingerprint of the ask as first composed. Extra properties on `req`
 * (signal, trace, project) are ignored — only `intent`, `params` and
 * `profile` are hashed. `profile` joins ONLY when present — an addition here
 * must follow the same present-only pattern or bump FINGERPRINT_VERSION.
 */
export function fingerprintRequest(req: { intent: InferenceModel; params?: ProviderParams; profile?: string }): string {
  return sha256Hex(
    canonicalize({
      v: FINGERPRINT_VERSION,
      intent: firstComposed(req.intent),
      params: req.params ?? null,
      ...(req.profile !== undefined ? { profile: req.profile } : {}),
    }),
  );
}
