import { Codes } from "@nola-lang/ast";
import {
  type AskContext,
  type AskResult,fingerprintRequest,
  type Message,
  mergeProviderParams,NolaIntentError,
  type NolaProvider,NolaResolutionError,
  type ProviderOutput,
  type ProviderRequest,redactError,
  type Site
} from "@nola-lang/core";
import type { InferContext } from "../infer-context/index.js";
import type { IntentOptions } from "../intents/index.js";
import type { AskSpan, Frame } from "../runtime/index.js";
import type { ValidationResult } from "./validate.js";

export type InferenceRequest = {
  /** The asking function's frame — lineage, history, spans. */
  frame: Frame;
  site: Site;
  options: IntentOptions;
  /** The ask-site context node (extract/call) — composed after the frame chain. */
  context?: InferContext;
};

export type InferParams = {
  messages: Message[];
  output: ProviderOutput;
}

export type CorrectionRequest = {
  frame: Frame;
  response: string;
  error: string;
}

/**
 * The ask boundary as a per-ask, single-shot strategy object. The base owns
 * everything invariant — span lifecycle, hook events, the request
 * fingerprint, the one-correction retry loop, the contract check, receipt
 * emission — so every strategy fires identical observability and hooks can
 * never miss an ask. Subclasses own the wire dialect through four seams:
 * composeInferParams / parse / validateResult / correctionRequest.
 * Middleware and the fingerprint cache are deliberately NOT wired in v1 —
 * pipeline.ts and the config sections stay as infrastructure. The runtime is
 * reached through the frame — the ask path never reads the global slot.
 */
export abstract class Inference {
  protected readonly askId: string = globalThis.crypto.randomUUID();
  protected readonly frame: Frame;
  protected readonly site: Site;

  // Per-ask state — assigned by infer() before the wire is touched; single-shot like Intent.
  protected span!: AskSpan;
  protected ctx!: AskContext;
  /** What composeInferParams returned (correction replaces it) — the seams read the contract here. */
  protected inferParams!: InferParams;
  private system = "";

  constructor(protected readonly request: InferenceRequest) {
    // Server-only v0 backstop: bundler plugins refuse .tsi in client bundles at
    // build time (NOLA4001); this catches whatever a pipeline lets through.
    const g = globalThis as { window?: unknown; document?: unknown };
    if (g.window !== undefined && g.document !== undefined) {
      throw new NolaIntentError(
        "Nola asks cannot execute in a browser context (server-only in v0). " +
          "Move this call behind a server boundary (server component, route handler, server action).",
        Codes.BrowserExecutionUnsupported,
      );
    }
    this.frame = request.frame;
    this.site = request.site;
  }

  protected get runtime() {
    return this.frame.runtime;
  }

  /** The composed conversation as one string — error reporting only. */
  private promptText(): string {
    return this.inferParams.messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
  }

  async infer(): Promise<unknown> {
    const { options } = this.request;

    this.runtime.latchConfig();

    this.system = this.runtime.system.systemText();
    
    this.span = this.frame.openAsk({ askId: this.askId, site: this.site });
    this.ctx = this.makeAskContext({
      askId: this.askId,
      site: this.site,
      provider: options.provider ?? this.frame.resolveProvider(),
    });

    // Resolved eagerly so askStart names the provider; forceProvider already wins here.
    const startProvider = this.runtime.resolveProvider(this.ctx.provider);
    this.runtime.emitEvent("onAskStart", {
      askId: this.askId,
      site: this.site,
      provider: startProvider.name,
    });

    try {
      const result = await this.terminal(this.ctx)

      this.span.servedBy = result.servedBy;

      // Values must honour the ask's type contract regardless of who served them
      // (redundant for the wire path today; guards future cache/short-circuit serves).
      const checked = this.validateResult(result.value);
      if (!checked.ok) {
        throw new NolaResolutionError(
          `Intent resolution failed at ${this.site} — value served by ${result.servedBy} does not match the requested schema: ${checked.error}`,
          { prompt: this.promptText(), raw: JSON.stringify(result.value) ?? "", site: this.site },
        );
      }

      this.span.outcome = { ok: true, value: checked.value };

      return checked.value;

    } catch (error) {
      this.span.outcome = { ok: false, error: redactError(error) };
      throw error;

    } finally {
      this.span.meta = this.ctx.meta;
      this.span.close();

      if (this.span.servedBy === "<unresolved>") {
        this.span.servedBy = startProvider.name;
      }

      this.runtime.emitEvent("onAskEnd", {
        askId: this.askId,
        receipt: this.span.toReceipt(this.frame.invocationId, this.frame.spanPath()),
      });
    }
  }

  private terminal = async (current: AskContext): Promise<AskResult> => {
    const provider = this.runtime.resolveProvider(current.provider);

    this.inferParams = this.composeInferParams(this.frame);
    this.span.originalPrompt = this.promptText();
    this.span.effectivePrompt = this.span.originalPrompt;

    let providerRequest: ProviderRequest = {
      system: this.system,
      signal: current.abortSignal,
      messages: this.inferParams.messages,
      output: this.inferParams.output,
      // The intent's own params are the nearest override over the frame chain.
      params: mergeProviderParams(this.frame.resolveParams(), this.request.options.params),
    };

    // The ask's identity is the request as first composed — a correction retry does not restamp.
    this.span.fingerprint = fingerprintRequest(providerRequest);
    if (providerRequest.output.syntax === "json" && providerRequest.output.schema) {
      this.span.schema = providerRequest.output.schema;
    }
    // TODO(cache): serve repeat fingerprints from config.cache.store when the cache is re-wired.

    let text = await this.callProvider(provider, providerRequest);
    let result = this.interpret(text);

    if (!result.ok) {
      this.recordValidationFailure(result.error);
      this.runtime.emitEvent("onRetry", {
        askId: this.askId,
        attempt: this.span.attempts.length,
        reason: result.error,
        site: this.site,
      });

      this.inferParams = this.correctionRequest({
        frame: this.frame,
        response: text,
        error: result.error
      });

      providerRequest = {
        ...providerRequest,
        messages: this.inferParams.messages,
        output: this.inferParams.output,
      };
      // "As sent": the correction changed the conversation, so the pair diverges here.
      this.span.effectivePrompt = this.promptText();

      text = await this.callProvider(provider, providerRequest);
      result = this.interpret(text);
    }

    if (!result.ok) {
      this.recordValidationFailure(result.error);
      throw new NolaResolutionError(`Intent resolution failed after retry at ${this.site} — ${result.error}`, {
        prompt: this.promptText(),
        raw: text,
        site: this.site,
      });
    }
    return { value: result.value, servedBy: provider.name };
  };

  private async callProvider(provider: NolaProvider, request: ProviderRequest): Promise<string> {
    // Fail fast on an already-elapsed timeout even when the provider ignores the signal.
    request.signal?.throwIfAborted();
    const attempt = this.span.attempts.length + 1;

    this.runtime.emitEvent("onProviderRequest", {
      askId: this.askId,
      attempt,
      provider: provider.name,
      messages: [...request.messages],
    });

    const { text, durationMs = NaN } = await provider.complete(request);

    this.span.attempts.push({
      attempt,
      provider: provider.name,
      durationMs
    });

    this.runtime.emitEvent("onProviderResponse", {
      askId: this.askId,
      attempt,
      provider: provider.name,
      text,
      durationMs,
    });

    return text;
  }

  /** parse then contract-check — the strategy's two seams composed. */
  private interpret(text: string): ValidationResult {
    const parsed = this.parse(text);
    if (!parsed.ok) return parsed;
    return this.validateResult(parsed.value);
  }

  private recordValidationFailure(error: string): void {
    const attempt = this.span.attempts.length;
    const failed = this.span.attempts[attempt - 1];
    if (failed) failed.validationError = error;
    this.runtime.emitEvent("onValidationFailed", {
      askId: this.askId,
      attempt,
      error,
      site: this.site,
    });
  }

  /** Runtime-owned fields are non-writable: assigning to them throws in ESM strict mode. */
  protected makeAskContext(init: {
    askId: string;
    site: Site;
    provider: AskContext["provider"];
  }): AskContext {
    const ctx = { provider: init.provider, meta: {} } as AskContext;
    const owned = {
      askId: init.askId,
      site: init.site,
      abortSignal: this.frame.abortSignal,
    };
    for (const [key, value] of Object.entries(owned)) {
      Object.defineProperty(ctx, key, { value, writable: false, enumerable: true });
    }
    return ctx;
  }


  /** The full provider payload for this ask — also the sole fingerprint input (plus system). */
  protected abstract composeInferParams(frame: Frame): InferParams;
  /** Wire text → candidate value. */
  protected abstract parse(text: string): ValidationResult;
  /** Candidate value → contract check against the composed output contract (this.inferParams). */
  protected abstract validateResult(value: unknown): ValidationResult;
  /** The replacement InferParams after a failed attempt — how a strategy phrases its retry. */
  protected abstract correctionRequest(init: CorrectionRequest): InferParams;
}