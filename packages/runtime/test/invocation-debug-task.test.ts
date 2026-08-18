import { nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
// internal class — the public surface is the Askable/Intent interfaces
import { InvocationIntent } from "../src/intents/invocation-intent.js";

const scope = () => nolaRuntime.current().fileContext("x.tsi").scope({ fn: "go", instruction: "" });

/**
 * The console.createTask bridge is what makes F11 across a bare
 * `await inferFn(...)` land in the body: the executor runs in a
 * thenable-assimilation microtask V8's async stepping cannot track, so the
 * intent schedules a debugger task at CONSTRUCTION (inside the caller's step
 * window) and starts it around the executor. Removing either half silently
 * turns step-into back into run-to-completion, so lock both.
 */
describe("InvocationIntent debugger task", () => {
  afterEach(() => vi.restoreAllMocks());

  it("schedules a console task at construction and runs the executor inside it", async () => {
    // vitest's console wrapper drops createTask, so install one directly
    const run = vi.fn(<R>(fn: () => R): R => fn());
    const createTask = vi.fn(() => ({ run }));
    const holder = console as { createTask?: unknown };
    const original = holder.createTask;
    holder.createTask = createTask;
    try {
      const executor = vi.fn(async () => "value");
      const intent = new InvocationIntent(executor, scope());
      expect(createTask).toHaveBeenCalledWith("nola infer");
      expect(run).not.toHaveBeenCalled(); // still lazy

      await expect(intent).resolves.toBe("value");
      expect(run).toHaveBeenCalledTimes(1);
      expect(executor).toHaveBeenCalledTimes(1);
    } finally {
      holder.createTask = original;
    }
  });

  it("executor failures propagate unchanged through the task wrapper", async () => {
    const intent = new InvocationIntent(async () => {
      throw new Error("boom");
    }, scope());
    await expect(intent).rejects.toThrow("boom");
  });

  it("survives environments without console.createTask", async () => {
    const original = (console as { createTask?: unknown }).createTask;
    (console as { createTask?: unknown }).createTask = undefined;
    try {
      const intent = new InvocationIntent(async () => 7, scope());
      await expect(intent).resolves.toBe(7);
    } finally {
      (console as { createTask?: unknown }).createTask = original;
    }
  });
});
