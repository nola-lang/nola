import { Codes } from "@nola-lang/ast";
import {
  INTENT_BRAND,
  type Intent as IntentContract,
  type ModelRef, 
  mergeProviderParams,NolaIntentError, 
  type ProviderParams
} from "@nola-lang/core";
import type { AskLocals, InferContext } from "../infer-context/index.js";
import { Frame, type NolaRuntime, nolaRuntime } from "../runtime/index.js";

export interface IntentOptions {
  retries?: number;
  model?: ModelRef;
  /**
   * Bounds this intent's execution, in ms. On an intent that roots an
   * invocation it is the root clock (default: config ask.timeoutMs; 0
   * disables) and every provider call in the invocation receives the signal.
   * On anything asked from a body — an extractor, a call intent, a callee
   * invocation — it is a bound of its own, combined with the invocation's
   * signal, whichever fires first; 0 sets none.
   */
  timeout?: number;
  /** wire-tuning knobs; resolved per-field along the frame chain, nearest frame wins */
  params?: ProviderParams;
  /** resolve without inheriting the caller frame's context (InvocationIntent only) */
  detached?: boolean;
  /**
   * The ask site's visible contextual bindings (`const .x`), set by `ask`
   * itself — never by user code. On an extract/call intent they describe the
   * scope the ask runs on; on a callee invocation, the caller scope as seen
   * from that call site.
   */
  locals?: AskLocals;
}

export type IntentExecutor<T> = (frame: Frame) => Promise<T>;

/**
 * Lazy, thenable, single-shot. `with*` methods clone (an unstarted copy with
 * merged options). `run(frame)` — the `ask` path — executes against the asking
 * function's frame so history is shared across sibling asks. `run()` without a
 * frame (bare thenable await) roots at the construction scope — a fresh root
 * frame per attempt; intents that carry no scope (extract/call — only `ask`
 * supplies their frame) fail with NOLA3010 instead.
 */
export abstract class Intent<T = unknown, TContext extends InferContext = InferContext> implements IntentContract<T> {
  static isIntent(v: unknown): v is Intent {
    return typeof v === "object" && v !== null && (v as { __nolaBrand?: unknown }).__nolaBrand === INTENT_BRAND;
  }

  readonly __nolaBrand = INTENT_BRAND;
  private started?: Promise<T>;

  constructor(
    protected readonly executor: IntentExecutor<T>,
    protected readonly inferContext?: TContext,
    protected readonly options: IntentOptions = {},
  ) { }

  /** The intent's own `.withTimeout(ms)`, when it set one — the module-body ask path roots its frame with it. */
  get timeout(): number | undefined {
    return this.options.timeout;
  }

  /** The owning runtime — through the construction scope when there is one. */
  protected get runtime(): NolaRuntime {
    return this.inferContext?.runtime ?? nolaRuntime.current();
  }

  // biome-ignore lint/suspicious/noThenProperty: Intent is intentionally a thenable (PromiseLike) — ask/await resolve it
  then<R1 = T, R2 = never>(
    onfulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }

  /**
   * Whole-ask retry: `retries` extra flat attempts of the entire execution
   * (see `runWithRetry`) — no backoff, and errors the provider-combinator
   * layer treats as definitive are re-attempted too. Wire-level retry with
   * backoff is the `withRetry(provider, policy)` combinator in config.
   */
  withRetry(retries: number): Intent<T> {
    return this.clone({ retries });
  }

  withModel(model: ModelRef): Intent<T> {
    return this.clone({ model });
  }

  withTimeout(timeout: number): Intent<T> {
    return this.clone({ timeout });
  }

  /** @internal the ask path attaches the site's contextual bindings (scope-bodies spec §3.3). */
  withLocals(locals: AskLocals): Intent<T> {
    return this.clone({ locals });
  }

  withParams(params: ProviderParams): Intent<T> {
    return this.clone({ params: mergeProviderParams(this.options.params, params) });
  }

  /**
   * Resolve without inheriting the caller frame's context. Meaningful for
   * InvocationIntent (a nola function call); a no-op for extractor intents,
   * which run against whatever frame `ask` hands them.
   */
  detached(): Intent<T> {
    return this.clone({ detached: true });
  }

  protected abstract clone(patch: Partial<IntentOptions>): Intent<T>;

  run(frame?: Frame): Promise<T> {
    if (!this.started) this.started = this.runWithRetry(frame);
    return this.started;
  }

  protected async runWithRetry(frame?: Frame): Promise<T> {
    const attempts = Math.max(1, (this.options.retries ?? 0) + 1);
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await this.infer(frame);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  protected async infer(parentFrame?: Frame): Promise<T> {
    // The ask path executes against the asking function's frame (shared
    // history, spans on the invocation); bare await roots at the
    // construction scope — a fresh root frame per attempt.
    const frame = parentFrame ?? this.openRootFrame();
    return this.executor(frame);
  }

  /** Bare-await rooting; ExecutableIntent overrides this to refuse (NOLA3010). */
  protected openRootFrame(): Frame {
    if (this.inferContext === undefined) {
      throw new NolaIntentError(
        "Intent carries no construction scope and no frame was supplied — resolve it through `ask`.",
        Codes.IntentWithoutContext,
      );
    }
    return Frame.open(this.inferContext, this.options);
  }
}


