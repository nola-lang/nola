import {
  ask,
  Frame,
  fmt,
  type InferContext,
  type IntentOptions,
  NolaResolutionError,
  nolaRuntime,
} from "@nola-lang/runtime";
import { describe, expect, it, vi } from "vitest";
// the abstract class is internal since the public surface became the
// Askable/Intent interfaces — tests subclass it via its direct path
import { Intent } from "../src/intents/intent.js";

const scope = () => nolaRuntime.current().fileContext("x.tsi").scope({ fn: "go", instruction: "" });
const frameOf = (infer: InferContext): Frame => Frame.open(infer);

/** Minimal concrete subclass — Intent itself is abstract (clone is per-subclass). */
class TestIntent<T> extends Intent<T> {
  protected clone(patch: Partial<IntentOptions>): Intent<T> {
    return new TestIntent<T>(this.executor, this.inferContext, { ...this.options, ...patch });
  }
}

describe("Intent base class", () => {
  it("is lazy: the executor does not run before then()", async () => {
    const executor = vi.fn(async () => 1);
    const i = new TestIntent(executor, scope());
    expect(executor).not.toHaveBeenCalled();
    expect(await i).toBe(1);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("memoizes: awaiting twice runs once", async () => {
    const executor = vi.fn(async () => 1);
    const i = new TestIntent(executor, scope());
    expect(await i).toBe(1);
    expect(await i).toBe(1);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("withRetry re-runs the whole executor; default is a single attempt", async () => {
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls < 3) throw new Error("boom");
      return "ok";
    };
    await expect(new TestIntent(flaky, scope())).rejects.toThrow("boom");
    calls = 0;
    expect(await new TestIntent(flaky, scope()).withRetry(2)).toBe("ok"); // 3 attempts
    expect(calls).toBe(3);
  });

  it("with* clones are fresh (unstarted) intents", async () => {
    const executor = vi.fn(async () => 1);
    const a = new TestIntent(executor, scope());
    await a;
    const b = a.withRetry(1);
    expect(b).not.toBe(a);
    await b;
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it("each self-run mints a fresh frame (fresh history) per attempt", async () => {
    const seen: number[] = [];
    const flaky = async (frame: Frame) => {
      seen.push(frame.history.length);
      frame.history.push({ prompt: "p", value: 1 });
      if (seen.length < 2) throw new Error("retry me");
      return "ok";
    };
    await new TestIntent(flaky, scope()).withRetry(1);
    expect(seen).toEqual([0, 0]); // retry started clean
  });

  it("isIntent brand check", () => {
    expect(Intent.isIntent(new TestIntent(async () => 1, scope()))).toBe(true);
    expect(Intent.isIntent({ prompt: "x" })).toBe(false);
  });
});

describe("ask/fmt", () => {
  it("ask runs an intent against the given frame (shared history)", async () => {
    const frame = frameOf(scope());
    const i = new TestIntent(async (f: Frame) => {
      f.history.push({ prompt: "p", value: 42 });
      return 42;
    }, scope());
    expect(await ask(i, frame)).toBe(42);
    expect(frame.history).toEqual([{ prompt: "p", value: 42 }]);
  });

  it("ask throws NolaResolutionError on a non-Intent", async () => {
    await expect(ask("nope", frameOf(scope()))).rejects.toBeInstanceOf(NolaResolutionError);
  });

  it("fmt splices strings as-is and JSON-stringifies the rest", () => {
    expect(fmt("abc")).toBe("abc");
    expect(fmt(42)).toBe("42");
    expect(fmt({ a: 1 })).toBe('{"a":1}');
    expect(fmt(undefined)).toBe("undefined");
  });
});
