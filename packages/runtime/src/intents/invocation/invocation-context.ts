import type { InferenceComposer } from "../../ask/composer.js";
import {
  type AskLocals,
  type ContextItem,
  InferContext,
  readItems,
  type VisibleContext,
} from "../../infer-context/infer-context.js";
import type { NolaRuntime } from "../../runtime/index.js";
import type { InferType } from "../../types/infer-type.js";

/** One infer-function parameter as harvested by lowering. */
export interface FunctionArg {
  name: string;
  /** omitted when the annotation is missing or underivable */
  type?: InferType<unknown>;
  /** true ⇔ the param was `.`-prefixed */
  contextual: boolean;
  /** populated only when contextual */
  value?: unknown;
  /** true ⇔ a `.`-contextual binding visible at the ask site, not a parameter */
  local?: true;
}

/** One `const .x` / `let .x` of a scope body as harvested by lowering — the static half (name + derived type). */
export interface LocalInit {
  name: string;
  type?: InferType<unknown>;
}

/** Static locals (name + type) joined with the ask site's live values, in declaration order; unknown names are skipped. */
export function localArgs(declared: readonly LocalInit[], locals: AskLocals | undefined): FunctionArg[] {
  if (!locals) return [];
  const out: FunctionArg[] = [];
  for (const l of declared) {
    if (!Object.hasOwn(locals, l.name)) continue;
    out.push({ name: l.name, type: l.type, contextual: true, value: locals[l.name], local: true });
  }
  return out;
}

export interface FunctionArgInit {
  name: string;
  type?: InferType<unknown>;
  contextual?: boolean;
  value?: unknown;
}

export interface FunctionScopeInit {
  fn: string;
  args?: readonly FunctionArgInit[];
  /** the body's contextual bindings (scope-bodies spec §5.2) — values arrive per ask */
  locals?: readonly LocalInit[];
  /** the module's TOP-LEVEL context items above this function's declaration, in source order (spec 2026-09-29 §3.3) */
  moduleContext?: readonly ContextItem[];
}

type FunctionScopeData = {
  fn: string;
  args: readonly FunctionArg[];
  locals: readonly LocalInit[];
  moduleContext: readonly ContextItem[];
};

/** One infer-function invocation scope. */
export class InvocationContext extends InferContext<FunctionScopeData> {
  /** @internal created via ModuleContext.func (and tests) only. Parentless = free-standing scope. */
  static create(init: FunctionScopeInit, runtime: NolaRuntime, parent?: InferContext): InvocationContext {
    const args = Object.freeze(
      (init.args ?? []).map((a) =>
        Object.freeze({ name: a.name, type: a.type, contextual: a.contextual ?? false, value: a.value }),
      ),
    );
    return new InvocationContext(
      Object.freeze({
        fn: init.fn,
        args,
        locals: Object.freeze((init.locals ?? []).map((l) => Object.freeze({ name: l.name, type: l.type }))),
        moduleContext: Object.freeze([...(init.moduleContext ?? [])]),
      }),
      runtime,
      parent,
    );
  }

  /**
   * Contributes this frame's ScopeDescription to the composer — fn, source
   * file (omitted when the lineage has no file root), the context items the
   * ask site saw (read now, joined by newlines), and the harvested args plus
   * the site's visible contextual bindings.
   */
  override compose(composer: InferenceComposer, visible?: VisibleContext): void {
    const { fn, args } = this.data;
    const file = this.sourceFile();
    composer.scope().describe({
      fn,
      ...(file === "<unknown>" ? {} : { file }),
      instruction: readItems(visible?.context),
      args: [...args, ...localArgs(this.data.locals, visible?.locals)],
    });
  }
}
