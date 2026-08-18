import type { InvocationEndEvent } from "@nola-lang/core";
import { mockProvider } from "@nola-lang/providers";
import type { Frame } from "@nola-lang/runtime";
import { __nola, NolaResolutionError, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => nolaRuntime.reset());

const fileCtx = () => nolaRuntime.current().fileContext("x.tsi");

const inferFn = (fn: string, body: (ctx: Frame) => Promise<unknown>) => () =>
  __nola.intents.Intent(body, fileCtx().func({ fn, instruction: "" }));

describe("invocation observability", () => {
  it("onInvocationEnd fires once per ROOT frame with the full trace (nested frames ride inside)", async () => {
    const events: InvocationEndEvent[] = [];
    nolaRuntime.configure({
      providers: { default: mockProvider(["v1", "v2"]) },
      hooks: [{ name: "cap", onInvocationEnd: (e) => events.push(e) }],
    });
    const b = inferFn("b", async (ctx) =>
      __nola.ask(__nola.intents.ExtractIntent({ instruction: "m", type: { type: "string" }, loc: "5:3" }), ctx),
    );
    const a = inferFn("a", async (ctx) => __nola.ask(b(), ctx));
    await a();
    expect(events).toHaveLength(1);
    expect(events[0]?.trace.fn).toBe("a");
    expect(events[0]?.trace.spans[0]).toMatchObject({ kind: "invocation", fn: "b" });
  });

  it("a failing ask leaves NolaResolutionError.trace covering spans up to the failure", async () => {
    nolaRuntime.configure({ providers: { default: mockProvider(["not-a-number", "still not"]) } });
    const a = inferFn("a", async (ctx) =>
      __nola.ask(__nola.intents.ExtractIntent({ instruction: "m", type: { type: "number" }, loc: "2:3" }), ctx),
    );
    const err = await a().then(
      () => {
        throw new Error("expected rejection");
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NolaResolutionError);
    const trace = (err as NolaResolutionError).trace;
    expect(trace?.fn).toBe("a");
    const span = trace?.spans[0];
    if (span?.kind !== "ask") throw new Error("expected ask span");
    expect(span.outcome.ok).toBe(false);
    expect(span.attempts).toHaveLength(2);
  });

  it("a throwing onInvocationEnd hook is swallowed with one warning (observer rule)", async () => {
    nolaRuntime.configure({
      providers: { default: mockProvider(["v"]) },
      hooks: [
        {
          name: "boom",
          onInvocationEnd: () => {
            throw new Error("boom");
          },
        },
      ],
    });
    const a = inferFn("a", async (ctx) =>
      __nola.ask(__nola.intents.ExtractIntent({ instruction: "m", type: { type: "string" }, loc: "1:1" }), ctx),
    );
    await expect(a()).resolves.toBe("v");
  });
});
