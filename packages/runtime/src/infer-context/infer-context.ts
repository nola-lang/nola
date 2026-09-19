import type { AskKind } from "@nola-lang/core";
import type { InferenceComposer } from "../ask/composer.js";
import type { NolaRuntime } from "../runtime/index.js";
import type { TypeCarrier } from "../types/infer-type.js";

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
 * The contextual bindings visible at one ask site, by name — the dynamic half
 * of `const .x` (scope-bodies spec §3.3): read when the ask runs, never stored
 * on a node. They describe the scope the ask runs in.
 */
export type AskLocals = Readonly<Record<string, unknown>>;

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

  /** Base nodes contribute nothing to the composed model. `locals` are the ask site's visible bindings (scope nodes list them). */
  compose(_composer: InferenceComposer, _locals?: AskLocals): void {}

  /** The ask-site identity; undefined for lineage nodes (system, file, function). */
  askIdentity(): AskIdentity | undefined {
    return undefined;
  }

  /**
   * The carrier the ask's reply is validated (and revived) against; undefined
   * for lineage nodes and for the raw-JsonSchema seam. Overridden by the
   * extract and call nodes (validation is carrier-driven since emit 15).
   */
  outputType(): TypeCarrier<unknown> | undefined {
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
