import type { InferenceComposer } from "../../ask/composer.js";
import type { FunctionPromptScope, PromptTemplate } from "../../ask/prompt-render.js";
import { InferContext } from "../../infer-context/infer-context.js";
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
}

export interface FunctionArgInit {
  name: string;
  type?: InferType<unknown>;
  contextual?: boolean;
  value?: unknown;
}

export interface FunctionScopeInit {
  fn: string;
  /** the marker text; for a template, the raw literal text with its holes verbatim */
  instruction?: string;
  /** lowered `${.member}` marker — replaces the CONTEXT block when present */
  template?: PromptTemplate<FunctionPromptScope>;
  args?: readonly FunctionArgInit[];
}

type FunctionScopeData = {
  fn: string;
  instruction: string;
  template?: PromptTemplate<FunctionPromptScope>;
  args: readonly FunctionArg[];
};

/** One infer-function invocation scope. */
export class InvocationContext extends InferContext<FunctionScopeData> {
  /** @internal created via FileInferContext.func (and tests) only. Parentless = free-standing scope. */
  static create(init: FunctionScopeInit, runtime: NolaRuntime, parent?: InferContext): InvocationContext {
    const args = Object.freeze(
      (init.args ?? []).map((a) =>
        Object.freeze({ name: a.name, type: a.type, contextual: a.contextual ?? false, value: a.value }),
      ),
    );
    return new InvocationContext(
      Object.freeze({
        fn: init.fn,
        instruction: init.instruction ?? "",
        ...(init.template ? { template: init.template } : {}),
        args,
      }),
      runtime,
      parent,
    );
  }

  /**
   * Contributes this frame's ScopeDescription to the composer — fn, source
   * file (omitted when the lineage has no file root), the authored
   * instruction, the harvested args, and the marker template when the
   * author wrote one.
   */
  override compose(composer: InferenceComposer): void {
    const { fn, instruction, args, template } = this.data;
    const file = this.sourceFile();
    composer.scope().describe({
      fn,
      ...(file === "<unknown>" ? {} : { file }),
      instruction,
      args,
      ...(template ? { template } : {}),
    });
  }
}
