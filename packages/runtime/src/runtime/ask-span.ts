import type { AskReceipt, AskSpanTrace, AttemptRecord, JsonSchema, Site } from "@nola-lang/core";

export interface AskSpanInit {
  askId: string;
  site: Site;
}

/** One `ask`: opened before the prompt is composed, written as attempts happen, closed on settle. */

export class AskSpan {
  readonly kind = "ask";
  readonly askId: string;
  readonly site: Site;
  /** The conversation as first composed — assigned when the strategy composes, not at open. */
  originalPrompt = "";
  /** As last sent to the provider — diverges from originalPrompt only on a correction retry. */
  effectivePrompt = "";
  schema: JsonSchema = { type: "string" };
  readonly attempts: AttemptRecord[] = [];
  servedBy = "<unresolved>";
  outcome: AskReceipt["outcome"] = { ok: false, error: "ask did not complete" };
  meta: Record<string, unknown> = {};
  fingerprint?: string;
  private readonly startedAt = Date.now();
  durationMs = 0;

  constructor(init: AskSpanInit) {
    this.askId = init.askId;
    this.site = init.site;
  }

  close(): void {
    this.durationMs = Date.now() - this.startedAt;
  }

  toReceipt(invocationId: string, spanPath: readonly string[]): AskReceipt {
    return {
      askId: this.askId,
      site: this.site,
      originalPrompt: this.originalPrompt,
      effectivePrompt: this.effectivePrompt,
      schema: this.schema,
      servedBy: this.servedBy,
      attempts: this.attempts.length,
      outcome: this.outcome,
      durationMs: this.durationMs,
      meta: this.meta,
      invocationId,
      spanPath,
      fingerprint: this.fingerprint,
    };
  }

  toTrace(): AskSpanTrace {
    return {
      kind: "ask",
      askId: this.askId,
      site: this.site,
      originalPrompt: this.originalPrompt,
      effectivePrompt: this.effectivePrompt,
      schema: this.schema,
      attempts: [...this.attempts],
      servedBy: this.servedBy,
      outcome: this.outcome,
      durationMs: this.durationMs,
      fingerprint: this.fingerprint,
    };
  }
}
