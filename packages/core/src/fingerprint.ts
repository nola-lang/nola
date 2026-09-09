import { createHash } from "node:crypto";
import type { ProviderParams } from "./index.js";
import { isInferenceModel, type ProviderPayload } from "./provider-dialect.js";
import { type ClassicPrompt, renderClassic } from "./render-classic.js";

/**
 * Version baked into every ask fingerprint. Bump when the canonical
 * serialization changes shape — old caches/ledgers must not silently match.
 * v5: the fingerprint is taken over the CLASSIC RENDERING of the ask plus
 * ProviderParams — a model payload is rendered first — so a model-dialect
 * provider (nola) and a chat provider key the same ask identically and one
 * ledger serves both. The cost: a Nola release that rephrases the classic
 * prompt re-keys every ledger.
 */
export const FINGERPRINT_VERSION = 5;

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

/**
 * The rendering as first composed: a model's `correction` is stripped before
 * rendering; a classic prompt keeps only its first user turn (the correction
 * pair is appended after it), so both shapes of one ask agree.
 */
function firstComposed(payload: ProviderPayload): ClassicPrompt {
  if (isInferenceModel(payload)) {
    const { correction: _correction, ...model } = payload;
    return renderClassic(model);
  }
  return { system: payload.system, messages: payload.messages.slice(0, 1), output: payload.output };
}

/**
 * Fingerprint of the ask as first composed. Extra properties on `req`
 * (signal, trace) are ignored — only `payload`, `params` and `profile` are
 * hashed. `profile` (the managed-mode ask-site name) joins ONLY when
 * present, so profile-free asks keep their v5 hashes and existing ledgers
 * stay valid — an addition here must follow the same present-only pattern
 * or bump FINGERPRINT_VERSION.
 */
export function fingerprintRequest(req: { payload: ProviderPayload; params?: ProviderParams; profile?: string }): string {
  return sha256Hex(
    canonicalize({
      v: FINGERPRINT_VERSION,
      prompt: firstComposed(req.payload),
      params: req.params ?? null,
      ...(req.profile !== undefined ? { profile: req.profile } : {}),
    }),
  );
}
