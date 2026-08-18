import { mockProvider } from "@nola-lang/providers";
import { ask, ExtractIntent, FunctionCallingIntent, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openTestFrame } from "./helpers/frame.js";

const ctx = () => openTestFrame();
const slot = (instruction: string) => new ExtractIntent<string>({ instruction, type: { type: "string" } });

/**
 * The console.createTask bridge for call intents, mirror of the
 * InvocationIntent one: the target function is invoked in a microtask after
 * the slot-filling provider round-trip, which V8's async stepping cannot
 * track — F11 at `ask fn(..`x`<T>)` surfaced in the runtime instead of the
 * target's body. The intent schedules a debugger task at CONSTRUCTION
 * (inside the ask site's step window) and runs the TARGET INVOCATION inside
 * it, so stepInto {breakOnAsyncCall} pauses right before user code.
 */
describe("FunctionCallingIntent debugger task", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    nolaRuntime.reset();
  });

  it("schedules a console task at construction and invokes the target inside it", async () => {
    // vitest's console wrapper drops createTask, so install one directly
    let insideRun = false;
    const run = vi.fn(<R>(fn: () => R): R => {
      insideRun = true;
      try {
        return fn();
      } finally {
        insideRun = false;
      }
    });
    const createTask = vi.fn(() => ({ run }));
    const holder = console as { createTask?: unknown };
    const original = holder.createTask;
    holder.createTask = createTask;
    try {
      nolaRuntime.configure({ providers: { default: mockProvider([{ arg0: "hi" }]) } });
      const target = vi.fn((s: string) => {
        expect(insideRun).toBe(true); // the invocation, not the whole execute
        return s.toUpperCase();
      });
      const intent = new FunctionCallingIntent<string>({ fn: target, name: "target", args: [slot("greeting")] });
      expect(createTask).toHaveBeenCalledWith("nola call");
      expect(run).not.toHaveBeenCalled(); // still lazy

      await expect(ask(intent, ctx())).resolves.toBe("HI");
      expect(run).toHaveBeenCalledTimes(1);
      expect(target).toHaveBeenCalledTimes(1);
    } finally {
      holder.createTask = original;
    }
  });

  it("wraps the invocation even when there are no slots (no provider call)", async () => {
    const run = vi.fn(<R>(fn: () => R): R => fn());
    const holder = console as { createTask?: unknown };
    const original = holder.createTask;
    holder.createTask = vi.fn(() => ({ run }));
    try {
      nolaRuntime.configure({ providers: { default: mockProvider([]) } });
      const intent = new FunctionCallingIntent<number>({ fn: (a: number) => a + 1, name: "inc", args: [41] });
      await expect(ask(intent, ctx())).resolves.toBe(42);
      expect(run).toHaveBeenCalledTimes(1);
    } finally {
      holder.createTask = original;
    }
  });

  it("target failures propagate unchanged through the task wrapper", async () => {
    nolaRuntime.configure({ providers: { default: mockProvider([]) } });
    const intent = new FunctionCallingIntent({
      fn: () => {
        throw new Error("boom");
      },
      name: "boom",
      args: [],
    });
    await expect(ask(intent, ctx())).rejects.toThrow("boom");
  });

  it("survives environments without console.createTask", async () => {
    const holder = console as { createTask?: unknown };
    const original = holder.createTask;
    holder.createTask = undefined;
    try {
      nolaRuntime.configure({ providers: { default: mockProvider([]) } });
      const intent = new FunctionCallingIntent<number>({ fn: () => 7, name: "seven", args: [] });
      await expect(ask(intent, ctx())).resolves.toBe(7);
    } finally {
      holder.createTask = original;
    }
  });
});
