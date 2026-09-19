import type { InferenceComposer } from "../../ask/composer.js";
import type { FunctionPromptScope, PromptTemplate } from "../../ask/prompt-render.js";
import { type AskLocals, InferContext } from "../../infer-context/infer-context.js";
import type { NolaRuntime } from "../../runtime/index.js";
import { type LocalInit, localArgs } from "./invocation-context.js";

/**
 * What lowering passes to `__nola_file_ctx().module({...})`: the body's
 * first-statement instruction (prose, or the raw text of a template whose
 * closure rides `template`) and its contextual bindings (static half).
 */
export interface ModuleScopeInit {
  instruction?: string;
  template?: PromptTemplate<FunctionPromptScope>;
  locals?: readonly LocalInit[];
}

type ModuleScopeData = {
  fn: "<module>";
  instruction: string;
  template?: PromptTemplate<FunctionPromptScope>;
  locals: readonly LocalInit[];
};

/**
 * The module body's scope — an implicit infer function named `<module>` with
 * no parameters and no wrapper, so the runtime (not lowered text) opens its
 * frame at each ask (scope-bodies spec §3.1). It describes itself only when
 * it has something to say — a contextual binding visible at the ask — so a
 * bare top-level ask renders as the plain TASK, with no phantom CONTEXT block.
 */
export class ModuleContext extends InferContext<ModuleScopeData> {
  /** @internal created via FileInferContext.module (and tests) only. */
  static create(init: ModuleScopeInit, runtime: NolaRuntime, parent: InferContext): ModuleContext {
    const locals = Object.freeze((init.locals ?? []).map((l) => Object.freeze({ name: l.name, type: l.type })));
    return new ModuleContext(
      Object.freeze({
        fn: "<module>" as const,
        instruction: init.instruction ?? "",
        ...(init.template ? { template: init.template } : {}),
        locals,
      }),
      runtime,
      parent,
    );
  }

  /** Describes the scope only when there is something to say: an instruction, a template, or a visible binding. */
  override compose(composer: InferenceComposer, locals?: AskLocals): void {
    const { fn, instruction, template } = this.data;
    const args = localArgs(this.data.locals, locals);
    if (args.length === 0 && instruction === "" && !template) return;
    const file = this.sourceFile();
    composer.scope().describe({
      fn,
      module: true,
      ...(file === "<unknown>" ? {} : { file }),
      instruction,
      args,
      ...(template ? { template } : {}),
    });
  }
}
