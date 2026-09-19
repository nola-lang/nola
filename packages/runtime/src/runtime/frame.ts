import {
  type HistoryRecord,
  type InvocationTrace,
  type ModelRef,
  mergeProviderParams,
  type ProviderParams,
} from "@nola-lang/core";
import type { InferenceComposer } from "../ask/composer.js";
import { DEFAULT_ASK_TIMEOUT_MS } from "../config.js";
import type { AskLocals, InferContext } from "../infer-context/index.js";
import type { IntentOptions } from "../intents/intent.js";
import { AskSpan, type AskSpanInit } from "./ask-span.js";
import type { NolaRuntime } from "./nola-runtime.js";

export type { HistoryRecord } from "@nola-lang/core";

/**
 * A one-shot abort clock. The timer is unref'd: an armed clock must not keep
 * the process alive — live provider calls hold their own handles.
 */
export function timeoutClock(ms: number, message: string): { signal: AbortSignal; timer: ReturnType<typeof setTimeout> } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(message)), ms);
  timer.unref?.();
  return { signal: controller.signal, timer };
}

/**
 * The per-invocation activation record — the one dynamic entity resolution
 * threads explicitly (the `__frame` an executor receives). Pairs a pointer to a
 * frozen InferContext node with everything mutable about this run: history
 * (locals), the ask-span tree (profiler), options, and the parent link
 * (return linkage). Frames exist only during resolution — construction scopes
 * are bare InferContext nodes. Context chains where `ask` happens; nothing is
 * ambient (no AsyncLocalStorage). Runtime-owned — never constructible from
 * .tsi (the __nola reserved prefix guards the factories).
 */
export class Frame {
  readonly invocationId: string = globalThis.crypto.randomUUID();
  /** wall-clock mint time — invocationEnd's durationMs is measured from it */
  readonly startedAt: number = Date.now();
  readonly history: HistoryRecord[] = [];
  private readonly children: Array<AskSpan | Frame> = [];
  /**
   * A root always owns one (the invocation's clock); a child owns one only when
   * its intent set a timeout of its own — every other child reads through
   * `abortSignal` to the nearest owner.
   */
  readonly #abort?: { signal: AbortSignal; timer?: ReturnType<typeof setTimeout> };

  private constructor(
    readonly infer: InferContext,
    readonly options: IntentOptions,
    readonly parent?: Frame,
  ) {
    // Self-attach is the only way a child frame enters a parent's span tree.
    parent?.children.push(this);
    // A callee's own timeout never loosens the caller's: it has no config default and 0 means "none of its own".
    const timeoutMs = parent
      ? (options.timeout ?? 0)
      : (options.timeout ?? this.runtime.config?.ask.timeoutMs ?? DEFAULT_ASK_TIMEOUT_MS);
    const armed = Number.isFinite(timeoutMs) && timeoutMs > 0;
    if (!parent || armed) {
      const clock = armed
        ? timeoutClock(timeoutMs, `Nola invocation timed out after ${timeoutMs}ms (IntentOptions.timeout / ask.timeoutMs)`)
        : undefined;
      const own = clock?.signal ?? new AbortController().signal;
      this.#abort = { signal: parent ? AbortSignal.any([parent.abortSignal, own]) : own, timer: clock?.timer };
    }
  }

  /** Root mint — bare thenable await, .detached(), or no caller frame. */
  static open(infer: InferContext, options: IntentOptions = {}): Frame {
    return new Frame(infer, options);
  }

  /** Child mint — stack-frame nesting under this frame. */
  child(infer: InferContext, options: IntentOptions = {}): Frame {
    return new Frame(infer, options, this);
  }

  /** The owning runtime, reached through the static node — the ask path never reads the global slot. */
  get runtime(): NolaRuntime {
    return this.infer.runtime;
  }

  /** The invocation's signal — every provider call under this frame receives it. */
  get abortSignal(): AbortSignal {
    if (this.#abort) return this.#abort.signal;
    // By construction a frame without #abort always has a parent.
    return (this.parent as Frame).abortSignal;
  }

  /** Stop this frame's timeout clock — called when the invocation settles; no-op on a frame that owns none. */
  settle(): void {
    if (this.#abort?.timer !== undefined) clearTimeout(this.#abort.timer);
  }

  /** One `ask` under this invocation: opened before the pipeline runs, closed on settle. */
  openAsk(init: AskSpanInit): AskSpan {
    const span = new AskSpan(init);
    this.children.push(span);
    return span;
  }

  /** Ask-site pin, nearest frame first (an outer invocation's pin covers callee asks). */
  resolveModel(): ModelRef | undefined {
    for (let f: Frame | undefined = this; f; f = f.parent) {
      if (f.options.model !== undefined) return f.options.model;
    }
    return undefined;
  }

  /**
   * Wire-tuning knobs, merged per-field along the chain: an outer invocation's
   * params cover callee asks; a nearer frame overrides field by field.
   */
  resolveParams(): ProviderParams | undefined {
    return mergeProviderParams(this.parent?.resolveParams(), this.options.params);
  }

  /** invocationIds from root frame to this frame. */
  spanPath(): readonly string[] {
    const path: string[] = [];
    for (let f: Frame | undefined = this; f; f = f.parent) path.unshift(f.invocationId);
    return path;
  }

  /** History as an ask sees it: caller-chain records first, this frame's own last. */
  historyChain(): ReadonlyArray<HistoryRecord> {
    const chain: HistoryRecord[][] = [];
    for (let f: Frame | undefined = this; f; f = f.parent) chain.unshift(f.history);
    return chain.flat();
  }

  /**
   * This frame's node describes its scope — with the contextual bindings the
   * ask site saw — and the caller chain composes one level out, each caller
   * described with the bindings ITS call site saw (`ask fn()` carries them on
   * the child frame's options).
   */
  compose(composer: InferenceComposer, locals?: AskLocals): void {
    this.infer.compose(composer, locals);
    this.parent?.compose(composer.outer(), this.options.locals);
  }

  /**
   * The .tsi file this frame's function is defined in (static chain first).
   * Scope-less intents (extract/call) carry no file root — for them the
   * caller chain answers.
   */
  sourceFile(): string {
    const own = this.infer.sourceFile();
    if (own !== "<unknown>") return own;
    return this.parent?.sourceFile() ?? "<unknown>";
  }

  /** The infer function's name, `<anonymous>` for a scope-less root. */
  fnName(): string {
    const fn = (this.infer.data as { fn?: unknown }).fn;
    return typeof fn === "string" ? fn : "<anonymous>";
  }

  toTrace(): InvocationTrace {
    return {
      kind: "invocation",
      invocationId: this.invocationId,
      fn: this.fnName(),
      file: this.sourceFile(),
      spans: this.children.map((c) => c.toTrace()),
    };
  }

  /** Callee return: exactly one collapsed HistoryRecord enters the caller's history. */
  collapse(value: unknown): void {
    this.parent?.history.push({ prompt: this.describe(), value });
  }

  /** "fn" or "fn: instruction" — the collapsed record's prompt. */
  private describe(): string {
    const { fn, instruction } = this.infer.data as { fn?: unknown; instruction?: unknown };
    const name = typeof fn === "string" ? fn : "<anonymous>";
    return typeof instruction === "string" && instruction !== "" ? `${name}: ${instruction}` : name;
  }
}
