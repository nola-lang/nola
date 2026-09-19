import type { LanguageModel } from "@nola-lang/core";
import { __nola, ExtractIntent, type Frame, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { openTestFrame } from "./helpers/frame.js";

afterEach(() => nolaRuntime.reset());

/** Never resolves on its own; rejects with the abort reason when the signal fires. */
function hangingProvider(): LanguageModel {
  return {
    name: "hang",
    complete: (req) =>
      new Promise((_, reject) => {
        req.signal?.addEventListener("abort", () => reject(req.signal?.reason), { once: true });
      }),
  };
}

const extract = () =>
  new ExtractIntent({ instruction: "p", type: { type: "string" }, loc: "1:1" }, nolaRuntime.current());

describe("invocation timeout", () => {
  it("IntentOptions.timeout aborts a hanging provider call", async () => {
    nolaRuntime.configure({ model: { default: hangingProvider() } });
    const frame = openTestFrame({ options: { timeout: 25 } });
    await expect(extract().run(frame)).rejects.toThrow(/timed out after 25ms/);
  });

  it("config ask.timeoutMs is the default when the intent sets none", async () => {
    nolaRuntime.configure({ model: { default: hangingProvider() }, ask: { timeoutMs: 25 } });
    const frame = openTestFrame();
    await expect(extract().run(frame)).rejects.toThrow(/timed out after 25ms/);
  });

  it("child frames read the root frame's signal", () => {
    const root = openTestFrame({ options: { timeout: 0 } });
    const child = root.child(root.infer.scope({ fn: "b" }));
    expect(child.abortSignal).toBe(root.abortSignal);
  });

  it("timeout: 0 disables the clock", async () => {
    nolaRuntime.configure({
      model: { default: { name: "fast", complete: async () => ({ text: '"ok"' }) } },
    });
    const frame = openTestFrame({ options: { timeout: 0 } });
    await expect(extract().run(frame)).resolves.toBe("ok");
    expect(frame.abortSignal.aborted).toBe(false);
  });

  it("an elapsed timeout fails fast before the provider is called", async () => {
    let calls = 0;
    nolaRuntime.configure({
      model: {
        default: {
          name: "count",
          complete: async () => {
            calls++;
            return { text: '"ok"' };
          },
        },
      },
    });
    const frame = openTestFrame({ options: { timeout: 5 } });
    await new Promise((r) => setTimeout(r, 25));
    await expect(extract().run(frame)).rejects.toThrow(/timed out after 5ms/);
    expect(calls).toBe(0);
  });

  it(".withTimeout on an extractor bounds that ask and leaves the invocation alive", async () => {
    nolaRuntime.configure({ model: { default: hangingProvider() } });
    const frame = openTestFrame({ options: { timeout: 0 } });
    await expect(extract().withTimeout(25).run(frame)).rejects.toThrow(/ask timed out after 25ms/);
    expect(frame.abortSignal.aborted).toBe(false);
  });

  it("the invocation's clock still aborts an ask that set a longer timeout of its own", async () => {
    nolaRuntime.configure({ model: { default: hangingProvider() } });
    const frame = openTestFrame({ options: { timeout: 25 } });
    await expect(extract().withTimeout(10_000).run(frame)).rejects.toThrow(/invocation timed out after 25ms/);
  });

  it(".withTimeout on an infer-function intent asked from a body bounds the callee invocation", async () => {
    nolaRuntime.configure({ model: { default: hangingProvider() } });
    const file = nolaRuntime.current().fileContext("x.tsi");
    const callee = () =>
      __nola.intents.Intent(
        async (__frame: Frame) => __nola.ask(extract(), __frame),
        file.func({ fn: "callee", instruction: "" }),
      );
    const caller = openTestFrame({ options: { timeout: 0 } });
    await expect(__nola.ask(callee().withTimeout(25), caller)).rejects.toThrow(/invocation timed out after 25ms/);
    expect(caller.abortSignal.aborted).toBe(false);
  });

  it("rejects a negative or non-numeric ask.timeoutMs", () => {
    expect(() =>
      nolaRuntime.configure({
        model: { default: hangingProvider() },
        ask: { timeoutMs: -1 },
      }),
    ).toThrow(/ask\.timeoutMs/);
  });
});
