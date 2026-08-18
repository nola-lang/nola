import type { InferenceComposer } from "../ask/composer.js";
import {
  type FunctionPromptData,
  type FunctionPromptScope,
  joinBlocks,
  type PromptTemplate,
  renderTemplate,
} from "../ask/prompt-render.js";
import type { NolaRuntime } from "../runtime/index.js";
import type { InferType } from "../types/infer-type.js";
import { type ComposeOptions, InferContext } from "./infer-context.js";

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
export class FunctionInferContext extends InferContext<FunctionScopeData> {
  /** @internal created via FileInferContext.func (and tests) only. Parentless = free-standing scope. */
  static create(init: FunctionScopeInit, runtime: NolaRuntime, parent?: InferContext): FunctionInferContext {
    const args = Object.freeze(
      (init.args ?? []).map((a) =>
        Object.freeze({ name: a.name, type: a.type, contextual: a.contextual ?? false, value: a.value }),
      ),
    );
    return new FunctionInferContext(
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

  override contributesText(): boolean {
    return true;
  }

  /**
   * One CONTEXT block per invocation. The node assembles FunctionPromptData;
   * without a template the runtime's PromptRenderer renders it and the
   * remainder follows; with a template (a `${.member}` marker) the template
   * renders the block from a FunctionPromptScope over the same data — `.default`
   * is the built-in block, `.next` the remainder (appended after the template
   * when it never reads it). The composed text is fingerprint input — keep it
   * deterministic.
   */
  override composeInferenceData(composer: InferenceComposer, opts?: ComposeOptions): void {
    const { fn, instruction, args, template } = this.data;
    const file = this.sourceFile();
    const data: FunctionPromptData = {
      kind: "function",
      fn,
      ...(file === "<unknown>" ? {} : { file }),
      instruction,
      args,
      nested: opts?.nested ?? false,
      hasContext: opts?.hasContext ?? false,
    };
    const renderer = this.runtime.promptRenderer;
    let memo: string | undefined;
    const rest = () => (memo ??= opts?.next?.() ?? "");
    if (!template) {
      composer.addText(joinBlocks(renderer.function(data), rest()));
      return;
    }
    let nextRead = false;
    const scope: FunctionPromptScope = Object.freeze({
      fn,
      signature: `${fn}(${args.map((a) => a.name).join(", ")})`,
      ...(data.file === undefined ? {} : { file: data.file }),
      args: Object.freeze(
        args.map((a) =>
          Object.freeze({
            name: a.name,
            ...(a.type ? { type: a.type.toNativeType() } : {}),
            contextual: a.contextual,
            value: a.value,
          }),
        ),
      ),
      nested: data.nested,
      hasContext: data.hasContext,
      // The template IS the instruction: the default block renders without Purpose.
      get default() {
        return renderer.function({ ...data, instruction: "" });
      },
      get next() {
        nextRead = true;
        return rest();
      },
    });
    composer.addText(renderTemplate(template, scope, `${file}:${fn}`, rest, () => nextRead));
  }
}
