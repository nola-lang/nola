import { Codes } from "@nola-lang/ast";
import type { InferRequest, LanguageModel, PlatformModel } from "@nola-lang/core";
import {
  DECISION_MODEL,
  fingerprintRequest,
  isDecisionModel,
  isPlatformModel,
  isToolModel,
  NolaConfigError,
  NolaProviderError,
  nodeAbsenceReason,
  nodeBuiltin,
  PLATFORM_MODEL,
  redactDeep,
  redactSecrets,
  TOOL_MODEL,
  type ToolCall,
} from "@nola-lang/core";
import { requireInfer } from "./require-infer.js";

type LedgerFs = {
  appendFileSync: (path: string, data: string, encoding: "utf8") => void;
  readFileSync: (path: string, encoding: "utf8") => string;
};

/** Ledgers live on disk: `node:fs` reached at call time (no static import); where there is none — a browser, or a Node older than 22.3 — the refusal says which. */
function ledgerFs(what: "record" | "replay"): LedgerFs {
  const fs = nodeBuiltin<LedgerFs>("node:fs");
  if (!fs) {
    throw new NolaConfigError(`${what}() needs a file system for its ledger — ${nodeAbsenceReason()}.`, Codes.ReplayLedgerInvalid);
  }
  return fs;
}

/**
 * Pass-through provider that appends `{ fingerprint, request, response }` JSONL
 * entries. The fingerprint is computed from the RAW request (so replay-time
 * lookups match) and is never redacted; persisted content strings are. The
 * ledger stores the INTENT (the ask as data, never a rendering), and `record`
 * carries the inner's brands: a platform inner yields a branded platform
 * model, a decision inner a decision model.
 */
export function record(inner: PlatformModel, ledgerPath: string): PlatformModel;
export function record(inner: LanguageModel, ledgerPath: string): LanguageModel;
export function record(inner: LanguageModel, ledgerPath: string): LanguageModel {
  const fs = ledgerFs("record");
  requireInfer([inner], "record");
  const brands = {
    ...(isPlatformModel(inner) ? { [PLATFORM_MODEL]: true as const } : {}),
    ...(isDecisionModel(inner) ? { [DECISION_MODEL]: true as const } : {}),
    ...(isToolModel(inner) ? { [TOOL_MODEL]: true as const } : {}),
  };
  return {
    ...brands,
    ...(inner.toolUse !== undefined ? { toolUse: inner.toolUse } : {}),
    name: `record(${inner.name})`,
    async infer(req: InferRequest) {
      const res = await inner.infer(req);
      const entry = {
        fingerprint: fingerprintRequest(req),
        request: { intent: redactDeep(req.intent), ...(req.params ? { params: req.params } : {}) },
        // a tool turn's calls ride the entry too, so a replayed tool-use ask runs its loop
        response: {
          text: redactSecrets(res.text),
          ...(res.toolCalls && res.toolCalls.length > 0 ? { toolCalls: redactDeep(res.toolCalls) } : {}),
        },
      };
      fs.appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`, "utf8");
      return res;
    },
  };
}

/**
 * Offline provider serving recorded responses by request fingerprint. Strict:
 * an unrecorded request is a definitive error, never a silent live call.
 *
 * A fingerprint is computed over the intent as first composed (see
 * `fingerprintRequest`), so a ledger recorded through any provider replays
 * for any other, and one ask's first attempt and its correction retry hash
 * identically — a recorded correction pair appends TWO ledger lines under
 * the SAME key. Entries are served FIFO per fingerprint: each `infer()`
 * shifts the next recorded response off that key's queue, so a replayed
 * session reproduces the correction turn instead of jumping straight to the
 * corrected answer. Once only one entry remains for a key it keeps serving
 * that last one — a single-entry key (the common case) behaves exactly as a
 * plain map lookup, and repeat asks beyond what was recorded still get an
 * answer instead of failing.
 */
export function replay(ledgerPath: string): LanguageModel {
  const fs = ledgerFs("replay");
  let raw: string;
  try {
    raw = fs.readFileSync(ledgerPath, "utf8");
  } catch (error) {
    throw new NolaConfigError(
      `replay ledger ${ledgerPath} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
      Codes.ReplayLedgerInvalid,
    );
  }
  type Hit = { text: string; toolCalls?: ToolCall[] };
  const entries = new Map<string, Hit[]>();
  raw.split("\n").forEach((line, i) => {
    if (line.trim() === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new NolaConfigError(`replay ledger ${ledgerPath}:${i + 1} is not valid JSON.`, Codes.ReplayLedgerInvalid);
    }
    const e = parsed as { fingerprint?: unknown; response?: { text?: unknown; toolCalls?: unknown } };
    if (typeof e.fingerprint !== "string" || typeof e.response?.text !== "string") {
      throw new NolaConfigError(
        `replay ledger ${ledgerPath}:${i + 1} is missing fingerprint or response.text.`,
        Codes.ReplayLedgerInvalid,
      );
    }
    const queue = entries.get(e.fingerprint);
    const toolCalls = Array.isArray(e.response.toolCalls) ? (e.response.toolCalls as ToolCall[]) : undefined;
    const hit: Hit = { text: e.response.text, ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}) };
    if (queue) queue.push(hit);
    else entries.set(e.fingerprint, [hit]);
  });
  return {
    // a ledger serves whatever it holds — a replayed decision or tool-use ask needs no live capability
    ...{ [DECISION_MODEL]: true as const, [TOOL_MODEL]: true as const },
    name: "replay",
    async infer(req: InferRequest) {
      const fingerprint = fingerprintRequest(req);
      const queue = entries.get(fingerprint);
      if (!queue || queue.length === 0) {
        throw new NolaProviderError(
          `[${Codes.ReplayFingerprintMismatch}] replay ledger ${ledgerPath} has no entry for fingerprint ${fingerprint} — the prompt, schema, or context changed since the ledger was recorded. Re-record it.`,
          { definitive: true },
        );
      }
      // Shift through recorded entries in ledger order; once the last one is
      // reached, keep serving it (repeat asks past what was recorded still resolve).
      const hit = queue.length > 1 ? (queue.shift() as Hit) : (queue[0] as Hit);
      return { text: hit.text, ...(hit.toolCalls ? { toolCalls: hit.toolCalls.map((c) => ({ ...c })) } : {}) };
    },
  };
}
