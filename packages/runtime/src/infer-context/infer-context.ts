import type { AskKind } from "@nola-lang/core";
import type { InferenceComposer } from "../ask/composer.js";
import type { NolaRuntime } from "../runtime/index.js";

/** What the ask boundary reports about the ask-site node: the kind, the display strings, the def stamp. */
export interface AskIdentity {
  kind: AskKind;
  instruction: string;
  def?: string;
  callee?: string;
  hint?: string;
  typeText?: string;
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

  /** Base nodes contribute nothing to the composed model. */
  compose(_composer: InferenceComposer): void {}

  /** The ask-site identity; undefined for lineage nodes (system, file, function). */
  askIdentity(): AskIdentity | undefined {
    return undefined;
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
