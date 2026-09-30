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
 * One lowered context statement (spec 2026-09-29 §3.3): the hoisted
 * `__nola_ctx_N` function, read at EACH ask that sees it, so a value in it is
 * rendered as it is at that ask.
 */
export type ContextItem = () => string;

/**
 * What one ask site sees (spec 2026-09-29 §3.4): the visible bindings by name
 * and the visible context items in source order — body items for an ask in an
 * infer body, module items for a module-body ask. Set by `ask` itself, never by
 * user code; on a callee invocation it is the caller scope as seen from the
 * call site.
 */
export interface VisibleContext {
  readonly locals?: AskLocals;
  readonly context?: readonly ContextItem[];
}

/** The items' texts, read now, joined by newlines; an item that renders nothing is skipped. */
export function readItems(items: readonly ContextItem[] | undefined): string {
  if (!items) return "";
  return items
    .map((item) => item())
    .filter((text) => text !== "")
    .join("\n");
}

/**
 * Frozen lineage node: system → module → function. Concrete subclasses are
 * created only by the runtime and by lowering (moduleContext / func) — never
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

  /** Base nodes contribute nothing to the composed model. `visible` is what the ask site sees (scope nodes read it). */
  compose(_composer: InferenceComposer, _visible?: VisibleContext): void {}

  /** The ask-site identity; undefined for lineage nodes (system, module, function). */
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
   * The `.tsi` file this context descends from: the module node up the
   * parent chain answers (ModuleContext overrides). A lineage with no file
   * root reports `<unknown>`.
   */
  sourceFile(): string {
    return this.parent?.sourceFile() ?? "<unknown>";
  }
}
