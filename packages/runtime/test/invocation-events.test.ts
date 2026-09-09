import type { InvocationEndEvent, InvocationStartEvent } from "@nola-lang/core";
import { mockProvider } from "@nola-lang/providers";
import type { Frame } from "@nola-lang/runtime";
import { __nola, NolaResolutionError, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => nolaRuntime.reset());

const fileCtx = () => nolaRuntime.current().fileContext("x.tsi");

const inferFn = (fn: string, body: (ctx: Frame) => Promise<unknown>) => () =>
  __nola.intents.Intent(body, fileCtx().func({ fn, instruction: "" }));

describe("invocation observability", () => {
  it("onInvocationStart fires per frame with the parent link, name, file and detached flag", async () => {
    const starts: InvocationStartEvent[] = [];
    nolaRuntime.configure({
      model: { default: mockProvider(["v1"]) },
      telemetry: [{ name: "cap", onInvocationStart: (e) => starts.push(e) }],
    });
    const b = inferFn("b", async (ctx) =>
      __nola.ask(__nola.intents.ExtractIntent({ instruction: "m", type: { type: "string" }, loc: "5:3" }), ctx),
    );
    const a = inferFn("a", async (ctx) => __nola.ask(b(), ctx));
    await a();
    expect(starts).toHaveLength(2);
    expect(starts[0]).toMatchObject({ fn: "a", file: "x.tsi", detached: false });
    expect(starts[0]?.parentInvocationId).toBeUndefined();
    expect(starts[0]?.spanPath).toEqual([starts[0]?.invocationId]);
    expect(starts[1]).toMatchObject({ fn: "b", file: "x.tsi", parentInvocationId: starts[0]?.invocationId });
    expect(starts[1]?.spanPath).toEqual([starts[0]?.invocationId, starts[1]?.invocationId]);
  });

  it("onInvocationEnd fires for EVERY frame — child first with its parent id, root last with the full trace", async () => {
    const ends: InvocationEndEvent[] = [];
    nolaRuntime.configure({
      model: { default: mockProvider(["v1", "v2"]) },
      telemetry: [{ name: "cap", onInvocationEnd: (e) => ends.push(e) }],
    });
    const b = inferFn("b", async (ctx) =>
      __nola.ask(__nola.intents.ExtractIntent({ instruction: "m", type: { type: "string" }, loc: "5:3" }), ctx),
    );
    const a = inferFn("a", async (ctx) => __nola.ask(b(), ctx));
    await a();
    expect(ends).toHaveLength(2);
    expect(ends[0]).toMatchObject({ status: "ok", parentInvocationId: ends[1]?.invocationId });
    expect(ends[0]?.trace).toMatchObject({ kind: "invocation", fn: "b" });
    expect(ends[1]?.parentInvocationId).toBeUndefined();
    expect(ends[1]?.trace.fn).toBe("a");
    expect(ends[1]?.trace.spans[0]).toMatchObject({ kind: "invocation", fn: "b" });
    expect(typeof ends[1]?.durationMs).toBe("number");
    expect(ends.filter((e) => e.parentInvocationId === undefined)).toHaveLength(1);
  });

  it("a throwing executor ends its frame with status error; .detached() reports detached: true", async () => {
    const starts: InvocationStartEvent[] = [];
    const ends: InvocationEndEvent[] = [];
    nolaRuntime.configure({
      model: { default: mockProvider([]) },
      telemetry: [{ name: "cap", onInvocationStart: (e) => starts.push(e), onInvocationEnd: (e) => ends.push(e) }],
    });
    const boom = inferFn("boom", async () => {
      throw new Error("boom");
    });
    await expect(boom().detached()).rejects.toThrow("boom");
    expect(starts[0]).toMatchObject({ fn: "boom", detached: true });
    expect(ends[0]).toMatchObject({ status: "error" });
  });

  it("a failing ask leaves NolaResolutionError.trace covering spans up to the failure", async () => {
    nolaRuntime.configure({ model: { default: mockProvider(["not-a-number", "still not"]) } });
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
      model: { default: mockProvider(["v"]) },
      telemetry: [
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
