import { type ConsoleTask, createDebugTask } from "@nola-lang/core";
import type { Frame } from "../../runtime/index.js";
import { Intent, type IntentExecutor, type IntentOptions } from "../intent.js";
import type { InvocationContext } from "./invocation-context.js";
import { runInvocation } from "./lifecycle.js";

/**
 * The intent an infer function returns. Resolution mints one Frame per attempt
 * from the frame passed via run() — the ask site (and not .detached()):
 * - with a caller frame: a child frame (stack-frame semantics — the callee's
 *   lineage and history read through the caller chain);
 * - otherwise (bare thenable await, plain-TS call): a root frame over the
 *   construction-scope node.
 * On return the frame collapses — exactly one HistoryRecord enters the
 * caller's history. Every frame emits onInvocationStart on mint and
 * onInvocationEnd on settle; a root's trace is the whole tree.
 */
export class InvocationIntent<T = unknown> extends Intent<T, InvocationContext> {
  /** Always present — the constructor requires it; narrows away the base's `?`. */
  protected declare readonly inferContext: InvocationContext;

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

  constructor(executor: IntentExecutor<T>, inferContext: InvocationContext, options: IntentOptions = {}) {
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

    return runInvocation(
      frame,
      (f) => (this.debugTask ? this.debugTask.run(() => this.executor(f)) : this.executor(f)),
      this.options.detached === true,
    );
  }
}
