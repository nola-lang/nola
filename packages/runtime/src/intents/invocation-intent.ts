import { NolaResolutionError } from "@nola-lang/core";
import type { FunctionInferContext } from "../infer-context/index.js";
import type { Frame } from "../runtime/index.js";
import { type ConsoleTask, createDebugTask } from "./debug-task.js";
import { Intent, type IntentExecutor, type IntentOptions } from "./intent.js";

/**
 * The intent an infer function returns. Resolution mints one Frame per attempt
 * from the frame passed via run() — the ask site (and not .detached()):
 * - with a caller frame: a child frame (stack-frame semantics — the callee's
 *   lineage and history read through the caller chain);
 * - otherwise (bare thenable await, plain-TS call): a root frame over the
 *   construction-scope node.
 * On return the frame collapses — exactly one HistoryRecord enters the
 * caller's history. Root frames emit onInvocationEnd exactly once.
 */
export class InvocationIntent<T = unknown> extends Intent<T, FunctionInferContext> {
  /** Always present — the constructor requires it; narrows away the base's `?`. */
  protected declare readonly inferContext: FunctionInferContext;

  /**
   * Debugger bridge for F11 across a bare `await inferFn(...)`. The executor
   * runs in a thenable-assimilation microtask that V8's async stepping does
   * not track, so a step-into at the call site used to fly to the caller's
   * resumption — after the whole invocation completed. `console.createTask`
   * IS tracked: scheduling the task here (construction runs inside the
   * caller's step window) and starting it around the executor makes V8's
   * `stepInto {breakOnAsyncCall}` pause at the task start, and the debugger's
   * skip/smart-step walk lands on the body's first statement. Runs are
   * per-attempt but the task is per-intent — fine, a task may run many times.
   */
  private readonly debugTask: ConsoleTask | undefined;

  constructor(executor: IntentExecutor<T>, inferContext: FunctionInferContext, options: IntentOptions = {}) {
    super(executor, inferContext, options);
    this.debugTask = createDebugTask("nola infer");
  }

  protected override clone(patch: Partial<IntentOptions>): Intent<T> {
    return new InvocationIntent<T>(this.executor, this.inferContext, { ...this.options, ...patch });
  }

  protected override async infer(parentFrame?: Frame): Promise<T> {
    const parent = this.options.detached ? undefined : parentFrame;

    const frame = parent
      ? parent.child(this.inferContext, this.options)
      : this.runtime.openFrame(this.inferContext, this.options);

    try {
      const value = await (this.debugTask ? this.debugTask.run(() => this.executor(frame)) : this.executor(frame));
      frame.collapse(value);

      return value;

    } catch (error) {
      if (error instanceof NolaResolutionError && !error.trace) {
        error.trace = frame.toTrace();
      }

      throw error;

    } finally {
      // Stop the timeout clock (no-op unless this frame is a root).
      frame.settle();
      // Root frames emit the whole trace once; nested traces ride inside it.
      if (!parent) {
        frame.runtime.emitEvent("onInvocationEnd", {
          invocationId: frame.invocationId,
          trace: frame.toTrace(),
        });
      }
    }
  }
}
