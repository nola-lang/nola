import { type ConsoleTask, createDebugTask, NolaResolutionError } from "@nola-lang/core";
import type { Frame } from "../../runtime/index.js";
import { Intent, type IntentExecutor, type IntentOptions } from "../intent.js";
import type { InvocationContext } from "./invocation-context.js";

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

    const lineage = parent ? { parentInvocationId: parent.invocationId } : {};
    // Every frame announces itself — root or attached — so a console can name it before it ends.
    frame.runtime.emitEvent("onInvocationStart", {
      invocationId: frame.invocationId,
      ...lineage,
      spanPath: frame.spanPath(),
      fn: frame.fnName(),
      file: frame.sourceFile(),
      detached: this.options.detached === true,
    });

    let failed = false;
    try {
      const value = await (this.debugTask ? this.debugTask.run(() => this.executor(frame)) : this.executor(frame));
      frame.collapse(value);

      return value;
    } catch (error) {
      failed = true;
      if (error instanceof NolaResolutionError && !error.trace) {
        error.trace = frame.toTrace();
      }

      throw error;
    } finally {
      // Stop the timeout clock (no-op unless this frame is a root).
      frame.settle();
      // Every frame ends; a root's trace is the whole tree, a child's its own subtree.
      frame.runtime.emitEvent("onInvocationEnd", {
        invocationId: frame.invocationId,
        ...lineage,
        status: failed ? "error" : "ok",
        durationMs: Date.now() - frame.startedAt,
        trace: frame.toTrace(),
      });
    }
  }
}
