import type { InferenceComposer } from "../ask/composer.js";
import type { NolaRuntime } from "../runtime/index.js";

/** Frame/builder-supplied hints for prompt composition (the node itself has no call-chain view). */
export interface ComposeOptions {
  /** true when the composing frame has a caller frame above it */
  nested?: boolean;
  /** true when earlier nodes already contributed text (builder-derived, not chain-derived) */
  hasContext?: boolean;
  /** Renders the remainder of the walk (nodes after this one); memoized by the builder. */
  next?: () => string;
}

/**
 * Frozen lineage node: system → file → function. Concrete subclasses are
 * created only by the runtime and by lowering (fileContext / func) — never
 * constructed from .tsi user code. Pure construction data: `data`, `parent`,
 * and the owning `runtime`. Everything dynamic (history, spans, options)
 * lives on the per-invocation Frame.
 */
export class InferContext<TInferParams extends Record<string, unknown> = Record<string, unknown>> {
  protected constructor(
    readonly data: Readonly<TInferParams>,
    readonly runtime: NolaRuntime,
    readonly parent?: InferContext,
  ) { }

  /** Anonymous child lineage node (pure data; used by tests and the ambient surface). */
  scope(data: Record<string, unknown>): InferContext {
    return new InferContext(Object.freeze({ ...data }), this.runtime, this);
  }

  /** Whether this node emits prompt text of its own (function/extract nodes do; bare scopes do not). */
  contributesText(): boolean {
    return false;
  }

  /** Base nodes contribute nothing — the remainder passes straight through. */
  composeInferenceData(composer: InferenceComposer, opts?: ComposeOptions): void {
    const rest = opts?.next?.() ?? "";
    if (rest) composer.addText(rest);
  }

  /**
   * The `.tsi` file this context descends from: the nearest file node up the
   * parent chain (FileInferContext overrides). A lineage with no file root
   * reports `<unknown>`.
   */
  sourceFile(): string {
    return this.parent?.sourceFile() ?? "<unknown>";
  }
}
