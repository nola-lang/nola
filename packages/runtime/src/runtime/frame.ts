import {
  type HistoryRecord,
  type InvocationTrace,
  type ModelRef,
  mergeProviderParams,
  type ProviderParams,
} from "@nola-lang/core";
import type { InferenceComposer } from "../ask/composer.js";
import { DEFAULT_ASK_TIMEOUT_MS } from "../config.js";
import type { ContextItem, InferContext, VisibleContext } from "../infer-context/index.js";
import type { IntentOptions } from "../intents/intent.js";
import { InvocationContext } from "../intents/invocation/invocation-context.js";
import { ModuleContext } from "../intents/invocation/module-context.js";
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
   * This frame's node describes its scope — with what the ask site saw — then
   * the module its function is DEFINED in (spec 2026-09-26 §3.3), then the
   * caller chain one level further out, each caller described with what ITS
   * call site saw (`ask fn()` carries it on the child frame's options).
   *
   * The module block renders ONCE per chain, by the outermost frame rooted in
   * or defined in that module, with the union of every view the chain
   * contributed for it (spec 2026-09-29 §3.4): a `<module>` frame's
   * `visible.context`, each function frame's `moduleContext`. `carried`
   * accumulates those views per module node as the recursion walks outward.
   */
  compose(composer: InferenceComposer, visible?: VisibleContext, carried = new Map<ModuleContext, ContextItem[][]>()): void {
    const node = this.infer;
    const module =
      node instanceof ModuleContext
        ? node
        : node instanceof InvocationContext && node.parent instanceof ModuleContext
          ? node.parent
          : undefined;
    if (module) {
      const own = node instanceof ModuleContext ? [...(visible?.context ?? [])] : [...(node as InvocationContext).data.moduleContext];
      carried.set(module, [...(carried.get(module) ?? []), own]);
    }
    if (node instanceof ModuleContext) node.compose(composer, visible, carried.get(node));
    else node.compose(composer, visible);
    let outer = composer.outer();
    if (module && !(node instanceof ModuleContext) && !this.callerBelongsTo(module)) {
      if (module.composeLexical(outer, carried.get(module) ?? [])) outer = outer.outer();
    }
    this.parent?.compose(outer, this.options.visible, carried);
  }

  /**
   * Whether a caller frame is rooted in the module (a `<module>` frame) or
   * defined in it (another function of the same file) — those render the
   * module further out, once, with this frame's view carried up to them.
   */
  private callerBelongsTo(module: ModuleContext): boolean {
    for (let f = this.parent; f; f = f.parent) {
      if (f.infer === module || f.infer.parent === module) return true;
    }
    return false;
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

  /** The collapsed record's prompt: the function's name — there is no static instruction since context statements (spec 2026-09-29 §3.4). */
  private describe(): string {
    return this.fnName();
  }
}
