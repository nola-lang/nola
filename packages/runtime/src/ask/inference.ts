import { Codes } from "@nola-lang/ast";
import {
  type AskContext,
  type AskResult,
  type ChatModel,
  findDecisionQuestions,
  fingerprintRequest,
  formatIssues,
  type InferenceModel,
  type InferModel,
  type InferRequest,
  isDecisionModel,
  isInferModel,
  isPlatformModel,
  type LanguageModel,
  mergeProviderParams,
  NolaIntentError,
  NolaResolutionError,
  type PlatformModel,
  type ProviderRequest,
  redactError,
  renderClassic,
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

/** The composed conversation as one string — receipts and error reporting. */
export function describeModel(model: InferenceModel): string {
  return renderClassic(model)
    .messages.map((m) => `${m.role}: ${m.content}`)
    .join("\n\n");
}

/**
 * The ask boundary as a per-ask, single-shot strategy object. The base owns
 * everything invariant — model composition, span lifecycle, hook events, the
 * request fingerprint, the one-correction retry loop, the contract check,
 * receipt emission — so every strategy fires identical observability.
 * Subclasses own the wire dialect through three seams: parse /
 * validateResult / correctionRequest. The method name is the dialect
 * (reshape design 2026-09-01): a managed provider takes the canonical
 * InferenceModel through `infer`, every classic provider takes the
 * rendering (`renderClassic`) through `complete`. Middleware
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
      ...(this.task.options.locals !== undefined ? { locals: this.task.options.locals } : {}),
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

    // One request has one shape — the METHOD NAME is the dialect (spec
    // 2026-09-18 §6.2): `infer` takes InferRequest { model }, `complete` takes
    // ProviderRequest with the rendering. Platform-only fields ride only the platform.
    const managed = isInferModel(provider);
    const platform = isPlatformModel(provider);
    const params = mergeProviderParams(this.frame.resolveParams(), this.task.options.params);
    // Deployment metadata for managed servers (per-project display/metering) — never the fingerprint.
    const project = this.runtime.config?.project;
    const requestFor = (m: InferenceModel): InferRequest | ProviderRequest => {
      const common = {
        // The intent's own params are the nearest override over the frame chain.
        params,
        signal: current.abortSignal,
        trace: { askId: this.askId, invocationId: this.frame.invocationId, spanPath: this.frame.spanPath() },
        // The managed-mode inference profile (ask with <name>) — joins the fingerprint.
        ...(profile !== undefined ? { profile } : {}),
      };
      if (managed) return { model: m, ...common, ...(platform && project !== undefined ? { project } : {}) };
      return { payload: renderClassic(m), ...common };
    };
    let request = requestFor(model);
    this.span.profile = profile;
    // The ask's identity is the request as first composed — a correction retry
    // does not restamp. A managed ask hashes the model; a classic ask its
    // rendering — identical by design (renderClassic is the fingerprint form).
    this.span.fingerprint = fingerprintRequest({
      payload: "model" in request ? request.model : request.payload,
      params: request.params,
      ...(profile !== undefined ? { profile } : {}),
    });
    // TODO(cache): serve repeat fingerprints from config.cache.store when the cache is re-wired.

    let text = await this.callProvider(provider, request);
    let result = this.interpret(text, model);

    if (!result.ok) {
      const reason = formatIssues(result.issues);
      this.recordValidationFailure(reason);
      this.runtime.emitEvent("onRetry", { askId: this.askId, attempt: this.span.attempts.length, reason, site: this.site });

      model = this.correctionRequest({ frame: this.frame, response: text, error: reason }, model);
      request = requestFor(model);
      // "As sent": the correction changed the conversation, so the pair diverges here.
      this.span.effectivePrompt = describeModel(model);

      text = await this.callProvider(provider, request);
      result = this.interpret(text, model);
    }

    if (!result.ok) {
      const reason = formatIssues(result.issues);
      this.recordValidationFailure(reason);
      throw new NolaResolutionError(`Intent resolution failed after retry at ${this.site} — ${reason}`, {
        prompt: describeModel(model),
        raw: text,
        site: this.site,
      });
    }
    return { model, value: result.value, servedBy: provider.name };
  };

  private async callProvider(
    provider: LanguageModel | InferModel | PlatformModel,
    request: InferRequest | ProviderRequest,
  ): Promise<string> {
    // Fail fast on an already-elapsed timeout even when the provider ignores the signal.
    request.signal?.throwIfAborted();
    const attempt = this.span.attempts.length + 1;
    this.runtime.emitEvent("onProviderRequest", {
      askId: this.askId,
      attempt,
      provider: provider.name,
      payload: "model" in request ? request.model : request.payload,
      ...(request.params ? { params: request.params } : {}),
      ...(request.profile !== undefined ? { profile: request.profile } : {}),
    });
    const { text, durationMs = NaN } =
      "model" in request
        ? await (provider as InferModel).infer(request)
        : await (provider as ChatModel).complete(request);
    this.span.attempts.push({ attempt, provider: provider.name, durationMs });
    this.runtime.emitEvent("onProviderResponse", { askId: this.askId, attempt, provider: provider.name, text, durationMs });
    return text;
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
