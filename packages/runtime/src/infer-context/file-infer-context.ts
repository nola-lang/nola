import { type FunctionScopeInit, InvocationContext } from "../intents/invocation/invocation-context.js";
import { ModuleContext, type ModuleScopeInit } from "../intents/invocation/module-context.js";
import type { NolaRuntime } from "../runtime/index.js";
import { InferContext } from "./infer-context.js";
import type { SystemInferContext } from "./system-infer-context.js";

type FileScopeData = { file: string };

/** The root context of one .tsi file, parented under the runtime's SystemInferContext. */
export class FileInferContext extends InferContext<FileScopeData> {
  /** @internal created by NolaRuntime.fileContext (and tests) only. */
  static create(file: string, parent: SystemInferContext, runtime: NolaRuntime): FileInferContext {
    return new FileInferContext(Object.freeze({ file }), runtime, parent);
  }

  get file(): string {
    return this.data.file;
  }

  override sourceFile(): string {
    return this.file;
  }

  #module?: ModuleContext;

  /**
   * The factory lowering calls for the module body: `__nola_file_ctx().module({...})`.
   * One node per file — the init is static text, so the first call's wins.
   */
  module(init: ModuleScopeInit): ModuleContext {
    this.#module = this.#module ?? ModuleContext.create(init, this.runtime, this);
    return this.#module;
  }

  /** The factory lowering calls: `__nola_file_ctx().func({...})`. */
  func(init: FunctionScopeInit): InvocationContext {
    return InvocationContext.create(init, this.runtime, this);
  }
}
