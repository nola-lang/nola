import { NolaResolutionError } from "@nola-lang/core";
import type { Frame } from "../../runtime/index.js";

/**
 * One invocation's lifecycle over an already-minted frame — root or attached:
 * announce it (so a console can name it before it ends), run the body,
 * collapse the result into the caller's history, stamp the trace on a
 * resolution error, stop the frame's clock, and end it. A root's trace is the
 * whole tree, a child's its own subtree. Shared by the infer-function intent
 * and the module body's asks (scope-bodies spec §3.1).
 */
export async function runInvocation<T>(frame: Frame, body: (frame: Frame) => Promise<T>, detached = false): Promise<T> {
  const lineage = frame.parent ? { parentInvocationId: frame.parent.invocationId } : {};
  frame.runtime.emitEvent("onInvocationStart", {
    invocationId: frame.invocationId,
    ...lineage,
    spanPath: frame.spanPath(),
    fn: frame.fnName(),
    file: frame.sourceFile(),
    detached,
  });

  let failed = false;
  try {
    const value = await body(frame);
    frame.collapse(value);

    return value;
  } catch (error) {
    failed = true;
    if (error instanceof NolaResolutionError && !error.trace) {
      error.trace = frame.toTrace();
    }

    throw error;
  } finally {
    // Stop the timeout clock (no-op on a frame that owns none).
    frame.settle();
    frame.runtime.emitEvent("onInvocationEnd", {
      invocationId: frame.invocationId,
      ...lineage,
      status: failed ? "error" : "ok",
      durationMs: Date.now() - frame.startedAt,
      trace: frame.toTrace(),
    });
  }
}
