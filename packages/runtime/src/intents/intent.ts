import { Codes } from "@nola-lang/ast";
import {
  INTENT_BRAND,
  type Intent as IntentContract,
  mergeProviderParams,NolaIntentError, 
  type ProviderParams,
  type ProviderRef
} from "@nola-lang/core";
import type { InferContext } from "../infer-context/index.js";
import { Frame, type NolaRuntime, nolaRuntime } from "../runtime/index.js";

export interface IntentOptions {
  retries?: number;
  provider?: ProviderRef;
  /**
   * Per-invocation timeout in ms, armed when this intent roots the invocation:
   * the root frame's AbortController fires when it elapses and every provider
   * call in the invocation receives the signal. 0 disables. Defaults to
   * config ask.timeoutMs.
   */
  timeout?: number;
  /** wire-tuning knobs; resolved per-field along the frame chain, nearest frame wins */
  params?: ProviderParams;
  /** resolve without inheriting the caller frame's context (InvocationIntent only) */
  detached?: boolean;
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

  withProvider(provider: ProviderRef): Intent<T> {
    return this.clone({ provider });
  }

  withTimeout(timeout: number): Intent<T> {
    return this.clone({ timeout });
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


