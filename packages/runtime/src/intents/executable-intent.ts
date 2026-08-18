import { Codes } from "@nola-lang/ast";
import { NolaIntentError } from "@nola-lang/core";
import type { InferContext } from "../infer-context/infer-context.js";
import type { Frame } from "../runtime/frame.js";
import { Intent, type IntentOptions } from "./intent.js";

/**
 * Base for intents whose executor is their own execute() (Extract,
 * FunctionCalling). They carry a context node (prompt composition) but no
 * scope: `ask` supplies the frame, so a bare thenable await fails with
 * NOLA3010.
 */

export abstract class ExecutableIntent<T = unknown, TContext extends InferContext = InferContext> extends Intent<T, TContext> {
  protected declare readonly inferContext: TContext;

  constructor(inferContext: TContext, options: IntentOptions = {}) {
    super((frame) => this.execute(frame), inferContext, options);
  }

  /** The context node is prompt data, not a scope — nothing to root from. */
  protected override openRootFrame(): never {
    throw new NolaIntentError(
      "extract/call intents carry no construction scope — only `ask` supplies their frame.",
      Codes.IntentWithoutContext,
    );
  }

  protected abstract execute(frame: Frame): Promise<T>;
}
