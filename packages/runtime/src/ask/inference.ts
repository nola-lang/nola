import { Codes } from "@nola-lang/ast";
import {
  type AskContext,
  type AskResult,
  findDecisionQuestions,
  fingerprintRequest,
  formatIssues,
  type InferenceModel,
  type InferRequest,
  type InferResult,
  isDecisionModel,
  isPlatformModel,
  type LanguageModel,
  mergeProviderParams,
  NolaIntentError,
  NolaResolutionError,
  redactError,
  renderPrompt,
  renderTranscript,
  type Site,
} from "@nola-lang/core";
import type { InferContext } from "../infer-context/index.js";
import type { IntentOptions } from "../intents/index.js";
import { timeoutClock } from "../runtime/frame.js";
import type { AskSpan, Frame } from "../runtime/index.js";
import { buildInferenceModel } from "./model-builder.js";
import type { ValidationResult } from "./validate.js";

export type InferenceTask = {
  /** The asking function's frame — lineage, history, spans. */
  frame: Frame;
  site: Site;
  options: IntentOptions;
  /** The ask-site context node (extract/call) — composes the intent; the frame chain composes the scopes. */
  context: InferContext;
};

export type CorrectionRequest = {
  frame: Frame;
  response: string;
  error: string;
};

/** The default rendering of an intent as one transcript — receipts (as first composed) and error reporting. */
export function describeModel(model: InferenceModel): string {
  return renderTranscript(renderPrompt(model));
}

/**
 * The ask boundary as a per-ask, single-shot strategy object. The base owns
 * everything invariant — model composition, span lifecycle, hook events, the
 * request fingerprint, the one-correction retry loop, the contract check,
 * receipt emission — so every strategy fires identical observability.
 * Subclasses own the wire dialect through three seams: parse /
 * validateResult / correctionRequest. Every model takes the canonical
 * InferenceModel through `infer` and renders it itself (prompt-rendering
 * spec 2026-09-28); what it sent comes back as `sent`. Middleware
 * and the fingerprint cache are deliberately NOT wired — pipeline.ts and the
 * config sections stay as infrastructure. The runtime is reached through the
 * frame — the ask path never reads the global slot.
 */
export abstract class Inference {
  protected readonly askId: string = globalThis.crypto.randomUUID();
  protected readonly frame: Frame;
  protected readonly site: Site;

  // Per-ask state — assigned by infer() before the wire is touched; single-shot like Intent.
  protected span!: AskSpan;
  protected ctx!: AskContext;
  private askTimer?: ReturnType<typeof setTimeout>;

  constructor(protected readonly task: InferenceTask) {
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
    this.frame = task.frame;
    this.site = task.site;
  }

  protected get runtime() {
    return this.frame.runtime;
  }

  async infer(): Promise<unknown> {
    const { options } = this.task;

    this.runtime.latchConfig();

    this.span = this.frame.openAsk({ askId: this.askId, site: this.site });
    this.ctx = this.makeAskContext({
      askId: this.askId,
      site: this.site,
      model: options.model ?? this.frame.resolveModel(),
    });

    // The ask-site node's identity: kind, display strings, and the compiler-stamped `def`.
    const identity = this.task.context.askIdentity();
    if (identity?.def !== undefined) this.span.def = identity.def;
    if (identity) this.span.askKind = identity.kind;

    // Resolved eagerly so askStart names the provider; forceModel already wins here.
    const startProvider = this.runtime.resolveModel(this.ctx.model);
    this.runtime.emitEvent("onAskStart", {
      askId: this.askId,
      site: this.site,
      provider: startProvider.name,
      invocationId: this.frame.invocationId,
      spanPath: this.frame.spanPath(),
      kind: identity?.kind ?? "extract",
      ...(identity?.def !== undefined ? { def: identity.def } : {}),
      ...(identity !== undefined ? { instruction: identity.instruction } : {}),
      ...(identity?.callee !== undefined ? { callee: identity.callee } : {}),
      ...(identity?.hint !== undefined ? { hint: identity.hint } : {}),
      ...(identity?.typeText !== undefined ? { typeText: identity.typeText } : {}),
    });

    try {
      const result = await this.terminal(this.ctx);
      this.span.servedBy = result.servedBy;

      // Values must honour the ask's type contract regardless of who served them
      // (redundant for the wire path today; guards future cache/short-circuit serves).
      const checked = this.validateResult(result.value, result.model);
      if (!checked.ok) {
        throw new NolaResolutionError(
          `Intent resolution failed at ${this.site} — value served by ${result.servedBy} does not match the requested schema: ${formatIssues(checked.issues)}`,
          { prompt: describeModel(result.model), raw: JSON.stringify(result.value) ?? "", site: this.site },
        );
      }
      this.span.outcome = { ok: true, value: checked.value };
      return checked.value;
    } catch (error) {
      this.span.outcome = { ok: false, error: redactError(error) };
      throw error;
    } finally {
      if (this.askTimer !== undefined) clearTimeout(this.askTimer);
      this.span.meta = this.ctx.meta;
      this.span.close();
      if (this.span.servedBy === "<unresolved>") this.span.servedBy = startProvider.name;
      this.runtime.emitEvent("onAskEnd", {
        askId: this.askId,
        receipt: this.span.toReceipt(this.frame.invocationId, this.frame.spanPath()),
      });
    }
  }

  /** The canonical ask: the ask-site node composes the intent, the frame chain the scopes. */
  protected buildModel(): InferenceModel {
    const system = this.runtime.system.systemMessage;
    return buildInferenceModel({
      frame: this.task.frame,
      context: this.task.context,
      site: this.site.toString(),
      ...(system !== undefined ? { system } : {}),
      ...(this.task.options.visible !== undefined ? { visible: this.task.options.visible } : {}),
    });
  }

  private terminal = async (current: AskContext): Promise<AskResult> => {
    const { model: provider, profile } = this.runtime.resolveModelProfile(current.model);

    let model = this.buildModel();
    this.span.originalPrompt = describeModel(model);
    this.span.effectivePrompt = this.span.originalPrompt;
    if (model.output.syntax === "json" && model.output.schema) this.span.schema = model.output.schema;

    // Decision types (spec 2026-09-18 §6.1): a chat model handed the answer
    // schema would fabricate a distribution, so a decision ask needs a branded
    // model — refused BEFORE the network, definitively.
    const decisions = model.output.syntax === "json" ? findDecisionQuestions(model.output.schema) : [];
    if (decisions.length > 0 && !isDecisionModel(provider)) {
      const first = decisions[0] as { path: string; question: { kind: string } };
      const kindName = { choice: "Choice", scale: "Scale", prob: "Prob" }[first.question.kind] ?? first.question.kind;
      const where = first.path === "" ? "the output type" : `output property ${JSON.stringify(first.path)}`;
      throw new NolaIntentError(
        `${where} is a ${kindName}; model "${provider.name}" cannot answer decision questions — route the ask to a decision model (\`ask with <name>\`) or use the plain form (a literal union, or boolean).`,
        Codes.DecisionModelRequired,
      );
    }

    // One request, one shape (prompt-rendering spec 2026-09-28 §3.4): every
    // model takes the intent through `infer` and renders it itself. `project`
    // rides only to the platform.
    const platform = isPlatformModel(provider);
    const params = mergeProviderParams(this.frame.resolveParams(), this.task.options.params);
    // Deployment metadata for the platform (per-project display/metering) — never the fingerprint.
    const project = this.runtime.config?.project;
    const requestFor = (m: InferenceModel): InferRequest => ({
      intent: m,
      // The intent's own params are the nearest override over the frame chain.
      params,
      signal: current.abortSignal,
      trace: { askId: this.askId, invocationId: this.frame.invocationId, spanPath: this.frame.spanPath() },
      // The managed-mode inference profile (ask with <name>) — joins the fingerprint.
      ...(profile !== undefined ? { profile } : {}),
      ...(platform && project !== undefined ? { project } : {}),
    });
    let request = requestFor(model);
    this.span.profile = profile;
    // The ask's identity is the intent as first composed — a correction retry
    // does not restamp (fingerprintRequest strips `correction`).
    this.span.fingerprint = fingerprintRequest(request);
    // TODO(cache): serve repeat fingerprints from config.cache.store when the cache is re-wired.

    let res = await this.callProvider(provider, request);
    let text = res.text;
    let result = this.interpret(text, model);

    if (!result.ok) {
      const reason = formatIssues(result.issues);
      this.recordValidationFailure(reason);
      this.runtime.emitEvent("onRetry", { askId: this.askId, attempt: this.span.attempts.length, reason, site: this.site });

      model = this.correctionRequest({ frame: this.frame, response: text, error: reason }, model);
      request = requestFor(model);
      res = await this.callProvider(provider, request);
      text = res.text;
      result = this.interpret(text, model);
    }

    if (!result.ok) {
      const reason = formatIssues(result.issues);
      this.recordValidationFailure(reason);
      throw new NolaResolutionError(`Intent resolution failed after retry at ${this.site} — ${reason}`, {
        prompt: this.span.effectivePrompt,
        raw: text,
        site: this.site,
      });
    }
    return { model, value: result.value, servedBy: provider.name };
  };

  /**
   * One provider round trip. "As last sent" is the provider's own echo when it
   * rendered text (`sent`), else the default rendering of the intent it
   * received — so a provider that renders differently is reported honestly.
   */
  private async callProvider(provider: LanguageModel, request: InferRequest): Promise<InferResult> {
    // Fail fast on an already-elapsed timeout even when the provider ignores the signal.
    request.signal?.throwIfAborted();
    const attempt = this.span.attempts.length + 1;
    this.runtime.emitEvent("onProviderRequest", {
      askId: this.askId,
      attempt,
      provider: provider.name,
      intent: request.intent,
      ...(request.params ? { params: request.params } : {}),
      ...(request.profile !== undefined ? { profile: request.profile } : {}),
    });
    // "As last sent" is set BEFORE the call, so a provider that throws still leaves the
    // in-flight conversation (a correction, say) on the receipt; the echo overwrites it.
    this.span.effectivePrompt = describeModel(request.intent);
    const res = await provider.infer(request);
    const durationMs = res.durationMs ?? NaN;
    this.span.attempts.push({ attempt, provider: provider.name, durationMs });
    if (res.sent) this.span.effectivePrompt = renderTranscript(res.sent);
    this.runtime.emitEvent("onProviderResponse", {
      askId: this.askId,
      attempt,
      provider: provider.name,
      text: res.text,
      durationMs,
      ...(res.sent ? { sent: res.sent } : {}),
    });
    return res;
  }

  /** parse then contract-check — the strategy's two seams composed. */
  private interpret(text: string, model: InferenceModel): ValidationResult {
    const parsed = this.parse(text);
    if (!parsed.ok) return parsed;
    return this.validateResult(parsed.value, model);
  }

  private recordValidationFailure(error: string): void {
    const attempt = this.span.attempts.length;
    const failed = this.span.attempts[attempt - 1];
    if (failed) failed.validationError = error;
    this.runtime.emitEvent("onValidationFailed", { askId: this.askId, attempt, error, site: this.site });
  }

  /**
   * The signal this ask's provider calls receive: the invocation's, narrowed by
   * the intent's own `.withTimeout(ms)` when it set one (0 = none of its own) —
   * whichever fires first. The clock is stopped when the ask settles.
   */
  private armSignal(): AbortSignal {
    const ms = this.task.options.timeout ?? 0;
    if (!Number.isFinite(ms) || ms <= 0) return this.frame.abortSignal;
    const clock = timeoutClock(ms, `Nola ask timed out after ${ms}ms (.withTimeout)`);
    this.askTimer = clock.timer;
    return AbortSignal.any([this.frame.abortSignal, clock.signal]);
  }

  /** Runtime-owned fields are non-writable: assigning to them throws in ESM strict mode. */
  protected makeAskContext(init: { askId: string; site: Site; model: AskContext["model"] }): AskContext {
    const ctx = { model: init.model, meta: {} } as AskContext;
    const owned = { askId: init.askId, site: init.site, abortSignal: this.armSignal() };
    for (const [key, value] of Object.entries(owned)) {
      Object.defineProperty(ctx, key, { value, writable: false, enumerable: true });
    }
    return ctx;
  }

  /** Wire text → candidate value. */
  protected abstract parse(text: string): ValidationResult;
  /** Candidate value → contract check against the model's output contract. */
  protected abstract validateResult(value: unknown, model: InferenceModel): ValidationResult;
  /** The model for the retry attempt after a failed one — how a strategy phrases its correction. */
  protected abstract correctionRequest(init: CorrectionRequest, model: InferenceModel): InferenceModel;
}
