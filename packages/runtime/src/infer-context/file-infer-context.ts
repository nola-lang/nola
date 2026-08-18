import type { NolaRuntime } from "../runtime/index.js";
import { FunctionInferContext, type FunctionScopeInit } from "./function-infer-context.js";
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

  /** The factory lowering calls: `__nola_file_ctx().func({...})`. */
  func(init: FunctionScopeInit): FunctionInferContext {
    return FunctionInferContext.create(init, this.runtime, this);
  }
}
