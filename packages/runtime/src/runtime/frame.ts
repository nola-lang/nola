import {
  type HistoryRecord,
  type InvocationTrace,
  mergeProviderParams,
  type ProviderParams,
  type ProviderRef,
} from "@nola-lang/core";
import type { InferenceComposer } from "../ask/composer.js";
import { DEFAULT_ASK_TIMEOUT_MS } from "../config.js";
import type { ComposeOptions, InferContext } from "../infer-context/index.js";
import type { IntentOptions } from "../intents/intent.js";
import { AskSpan, type AskSpanInit } from "./ask-span.js";
import type { NolaRuntime } from "./nola-runtime.js";

export type { HistoryRecord } from "@nola-lang/core";

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
  readonly history: HistoryRecord[] = [];
  private readonly children: Array<AskSpan | Frame> = [];
  /** Root frames only — one controller per invocation; children read through `abortSignal`. */
  readonly #abort?: { controller: AbortController; timer?: ReturnType<typeof setTimeout> };

  private constructor(
    readonly infer: InferContext,
    readonly options: IntentOptions,
    readonly parent?: Frame,
  ) {
    // Self-attach is the only way a child frame enters a parent's span tree.
    parent?.children.push(this);
    if (!parent) {
      const controller = new AbortController();
      const timeoutMs = options.timeout ?? this.runtime.config?.ask.timeoutMs ?? DEFAULT_ASK_TIMEOUT_MS;
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timer = setTimeout(
          () => controller.abort(new Error(`Nola invocation timed out after ${timeoutMs}ms (IntentOptions.timeout / ask.timeoutMs)`)),
          timeoutMs,
        );
        // Don't let an armed clock keep the process alive; live provider calls hold their own handles.
        timer.unref?.();
      }
      this.#abort = { controller, timer };
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

  /** The root invocation's signal — every provider call receives it. */
  get abortSignal(): AbortSignal {
    if (this.#abort) return this.#abort.controller.signal;
    // By construction a frame without #abort always has a parent.
    return (this.parent as Frame).abortSignal;
  }

  /** Stop the root timeout clock — called when the invocation settles; no-op on child frames. */
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
  resolveProvider(): ProviderRef | undefined {
    for (let f: Frame | undefined = this; f; f = f.parent) {
      if (f.options.provider !== undefined) return f.options.provider;
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

  composeInferenceData(composer: InferenceComposer, opts?: Omit<ComposeOptions, "nested">): void {
    // The node has no call-chain view — the frame supplies it; builder hints pass through.
    this.infer.composeInferenceData(composer, { ...opts, nested: this.parent !== undefined });
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

  toTrace(): InvocationTrace {
    const fn = (this.infer.data as { fn?: unknown }).fn;
    return {
      kind: "invocation",
      invocationId: this.invocationId,
      fn: typeof fn === "string" ? fn : "<anonymous>",
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
