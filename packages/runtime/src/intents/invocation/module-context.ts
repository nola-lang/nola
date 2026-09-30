import type { InferenceComposer } from "../../ask/composer.js";
import { type ContextItem, InferContext, readItems, type VisibleContext } from "../../infer-context/infer-context.js";
import type { SystemInferContext } from "../../infer-context/system-infer-context.js";
import type { NolaRuntime } from "../../runtime/index.js";
import { type FunctionScopeInit, InvocationContext, type LocalInit, localArgs } from "./invocation-context.js";

/**
 * What lowering passes through `__nola.context.module(file, emit, () => init)`
 * (spec 2026-09-29 §3.3): the module body's TOP-LEVEL context items in source
 * order — the canonical order every union below is sorted by — and its
 * contextual bindings (static half).
 */
export interface ModuleScopeInit {
  context?: readonly ContextItem[];
  locals?: readonly LocalInit[];
}

type ModuleScopeData = {
  file: string;
  fn: "<module>";
  context: readonly ContextItem[];
  locals: readonly LocalInit[];
};

/**
 * The one node of a .tsi file (emit 19, spec 2026-09-26 §3.1): the root of the
 * file's lineage (system → module → function — it answers `sourceFile()`), the
 * module body's scope — an implicit infer function named `<module>` with no
 * parameters and no wrapper, so the runtime (not lowered text) opens its frame
 * at each ask (scope-bodies spec §3.1) — and the parent of every infer-function
 * scope declared in the file (`func`). It describes itself only when it has
 * something to say — a context item visible at the ask or a visible binding —
 * so a bare top-level ask renders as the plain TASK.
 */
export class ModuleContext extends InferContext<ModuleScopeData> {
  /** @internal created by NolaRuntime.moduleContext (and tests) only. */
  static create(file: string, init: ModuleScopeInit, runtime: NolaRuntime, parent: SystemInferContext): ModuleContext {
    const locals = Object.freeze((init.locals ?? []).map((l) => Object.freeze({ name: l.name, type: l.type })));
    return new ModuleContext(
      Object.freeze({ file, fn: "<module>" as const, context: Object.freeze([...(init.context ?? [])]), locals }),
      runtime,
      parent,
    );
  }

  get file(): string {
    return this.data.file;
  }

  override sourceFile(): string {
    return this.data.file;
  }

  /** The factory the infer-function closer calls: `__nola_module_ctx().func({...})`. */
  func(init: FunctionScopeInit): InvocationContext {
    return InvocationContext.create(init, this.runtime, this);
  }

  /**
   * The chain's views of this module merged into one list (spec 2026-09-29
   * §3.4): every item once, in the canonical order of the init's `context`
   * list. A block-scoped module item is never in that list — it keeps its
   * place directly after the top-level item that precedes it in its own list
   * (a stable sort on index + 0.5).
   */
  orderedUnion(lists: ReadonlyArray<readonly ContextItem[]>): ContextItem[] {
    const canonical = new Map<ContextItem, number>(this.data.context.map((item, i) => [item, i]));
    const keyed = new Map<ContextItem, number>();
    for (const list of lists) {
      let last = -1;
      for (const item of list) {
        const i = canonical.get(item);
        if (i !== undefined) {
          last = i;
          keyed.set(item, i);
        } else if (!keyed.has(item)) {
          keyed.set(item, last + 0.5);
        }
      }
    }
    return [...keyed.entries()].sort((a, b) => a[1] - b[1]).map(([item]) => item);
  }

  /**
   * The lexical layer (spec 2026-09-26 §3.3): this module described from a
   * function's definition site — no bindings, and marked `lexical` so the
   * renderer knows it was entered, not called. `lists` are the views the
   * chain contributed (each function's `moduleContext`). Returns whether a
   * block was described: nothing to say, no block.
   */
  composeLexical(composer: InferenceComposer, lists: ReadonlyArray<readonly ContextItem[]>): boolean {
    const instruction = readItems(this.orderedUnion(lists));
    if (instruction === "") return false;
    const { fn, file } = this.data;
    composer.scope().describe({ fn, module: true, lexical: true, file, instruction, args: [] });
    return true;
  }

  /**
   * The `<module>` frame's own block: the union of the lists the chain handed
   * it — the ask's or call site's `visible.context` and every inner function's
   * `moduleContext` — plus the visible bindings. Nothing to say, no block.
   */
  override compose(
    composer: InferenceComposer,
    visible?: VisibleContext,
    lists: ReadonlyArray<readonly ContextItem[]> = [visible?.context ?? []],
  ): void {
    const instruction = readItems(this.orderedUnion(lists));
    const args = localArgs(this.data.locals, visible?.locals);
    if (instruction === "" && args.length === 0) return;
    const { fn, file } = this.data;
    composer.scope().describe({ fn, module: true, file, instruction, args });
  }
}
