/** `console.createTask` (V8 debugger async-task API; Node ≥ 19.7, untyped in @types/node). */
export type ConsoleTask = { run<R>(fn: () => R): R };

/**
 * Debugger bridge shared by InvocationIntent ("nola infer") and
 * FunctionCallingIntent ("nola call"): work that resumes in a microtask
 * V8's async stepping cannot track runs inside a console task scheduled at
 * intent CONSTRUCTION (the ask/call site's step window), so
 * `stepInto {breakOnAsyncCall}` pauses at the task start instead of flying
 * to the caller's resumption.
 */
export const createDebugTask = (name: string): ConsoleTask | undefined =>
  (console as { createTask?: (name: string) => ConsoleTask }).createTask?.(name);
