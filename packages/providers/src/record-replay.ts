import { appendFileSync, readFileSync } from "node:fs";
import { Codes } from "@nola-lang/ast";
import type { NolaProvider } from "@nola-lang/core";
import { fingerprintRequest, NolaConfigError, NolaProviderError, redactSecrets } from "@nola-lang/core";

/**
 * Pass-through provider that appends `{ fingerprint, request, response }` JSONL
 * entries. The fingerprint is computed from the RAW request (so replay-time
 * lookups match) and is never redacted; persisted content strings are.
 */
export function record(inner: NolaProvider, ledgerPath: string): NolaProvider {
  return {
    name: `record(${inner.name})`,
    async complete(req) {
      const res = await inner.complete(req);
      const entry = {
        fingerprint: fingerprintRequest(req),
        request: {
          system: redactSecrets(req.system),
          messages: req.messages.map((m) => ({ role: m.role, content: redactSecrets(m.content) })),
          output: req.output,
        },
        response: { text: redactSecrets(res.text) },
      };
      appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`, "utf8");
      return res;
    },
  };
}

/**
 * Offline provider serving recorded responses by request fingerprint. Strict:
 * an unrecorded request is a definitive error, never a silent live call.
 */
export function replay(ledgerPath: string): NolaProvider {
  let raw: string;
  try {
    raw = readFileSync(ledgerPath, "utf8");
  } catch (error) {
    throw new NolaConfigError(
      `replay ledger ${ledgerPath} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
      Codes.ReplayLedgerInvalid,
    );
  }
  const entries = new Map<string, { text: string }>();
  raw.split("\n").forEach((line, i) => {
    if (line.trim() === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new NolaConfigError(`replay ledger ${ledgerPath}:${i + 1} is not valid JSON.`, Codes.ReplayLedgerInvalid);
    }
    const e = parsed as { fingerprint?: unknown; response?: { text?: unknown } };
    if (typeof e.fingerprint !== "string" || typeof e.response?.text !== "string") {
      throw new NolaConfigError(
        `replay ledger ${ledgerPath}:${i + 1} is missing fingerprint or response.text.`,
        Codes.ReplayLedgerInvalid,
      );
    }
    entries.set(e.fingerprint, { text: e.response.text });
  });
  return {
    name: "replay",
    async complete(req) {
      const fingerprint = fingerprintRequest(req);
      const hit = entries.get(fingerprint);
      if (!hit) {
        throw new NolaProviderError(
          `[${Codes.ReplayFingerprintMismatch}] replay ledger ${ledgerPath} has no entry for fingerprint ${fingerprint} — the prompt, schema, or context changed since the ledger was recorded. Re-record it.`,
          { definitive: true },
        );
      }
      return { text: hit.text };
    },
  };
}
