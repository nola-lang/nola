import type { NolaRuntime } from "../runtime/index.js";
import { InferContext } from "./infer-context.js";

/**
 * Process-scope root, one per NolaRuntime instance. Carries the configured
 * system message — read through a thunk at ask time, because the runtime
 * exists before nolaRuntime.configure() runs and config latches at the first ask.
 * Feeds `model.system` only: promptData() is undefined, so it never appears
 * in lineage JSON or fingerprint lineage.
 */
export class SystemInferContext extends InferContext<Record<string, never>> {
  #readMessage: () => string | undefined;

  private constructor(readMessage: () => string | undefined, runtime: NolaRuntime) {
    super(Object.freeze({}) as Record<string, never>, runtime);
    this.#readMessage = readMessage;
  }

  /** @internal created by NolaRuntime (and tests) only. */
  static create(readMessage: () => string | undefined, runtime: NolaRuntime): SystemInferContext {
    return new SystemInferContext(readMessage, runtime);
  }

  get systemMessage(): string | undefined {
    return this.#readMessage();
  }
}
