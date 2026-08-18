import { Site } from "@nola-lang/core";
import { Frame, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => nolaRuntime.reset());

const fnNode = (data: Record<string, unknown> = { fn: "go", instruction: "" }, file = "x.tsi") =>
  nolaRuntime.current().fileContext(file).scope(data);

describe("Frame", () => {
  it("openAsk records a span; toReceipt matches the receipt shape plus identity", () => {
    const frame = Frame.open(fnNode());
    const span = frame.openAsk({ askId: "a1", site: new Site("x.tsi", "3:7") });
    // Prompt/schema are assigned when the strategy composes, not at open.
    span.originalPrompt = "p";
    span.effectivePrompt = "p";
    span.schema = { type: "string" };
    span.attempts.push({ attempt: 1, provider: "mock", durationMs: 5 });
    span.servedBy = "mock";
    span.outcome = { ok: true, value: "v" };
    span.close();
    const receipt = span.toReceipt(frame.invocationId, frame.spanPath());
    expect(receipt).toMatchObject({
      askId: "a1",
      site: { file: "x.tsi", loc: "3:7" },
      originalPrompt: "p",
      effectivePrompt: "p",
      schema: { type: "string" },
      servedBy: "mock",
      attempts: 1,
      outcome: { ok: true, value: "v" },
      meta: {},
      invocationId: frame.invocationId,
      spanPath: [frame.invocationId],
    });
    expect(typeof receipt.durationMs).toBe("number");
  });

  it("child frames self-attach: trace nests, spanPath is root-first, fn/file derive from the static node", () => {
    const root = Frame.open(fnNode({ fn: "a", instruction: "" }, "a.tsi"));
    const child = root.child(fnNode({ fn: "b", instruction: "" }, "b.tsi"));
    expect(child.spanPath()).toEqual([root.invocationId, child.invocationId]);
    const trace = root.toTrace();
    expect(trace).toMatchObject({ kind: "invocation", fn: "a", file: "a.tsi" });
    expect(trace.spans).toHaveLength(1);
    expect(trace.spans[0]).toMatchObject({ kind: "invocation", fn: "b", file: "b.tsi" });
  });

  it("resolveProvider walks the frame chain nearest-first", () => {
    const root = Frame.open(fnNode({ fn: "a" }), { provider: "outer" });
    const child = root.child(fnNode({ fn: "b" }));
    expect(child.resolveProvider()).toBe("outer");
    const pinned = root.child(fnNode({ fn: "c" }), { provider: "inner" });
    expect(pinned.resolveProvider()).toBe("inner");
  });

  it("historyChain reads caller records first; collapse pushes exactly one record onto the parent", () => {
    const root = Frame.open(fnNode({ fn: "a", instruction: "" }));
    root.history.push({ prompt: "first", value: 1 });
    const child = root.child(fnNode({ fn: "b", instruction: "find it" }));
    child.history.push({ prompt: "inner", value: 2 });
    expect(child.historyChain()).toEqual([
      { prompt: "first", value: 1 },
      { prompt: "inner", value: 2 },
    ]);
    child.collapse("v1");
    expect(root.history).toEqual([
      { prompt: "first", value: 1 },
      { prompt: "b: find it", value: "v1" },
    ]);
    expect(child.history).toEqual([{ prompt: "inner", value: 2 }]);
  });

  it("resolveParams merges per-field along the chain, nearest frame winning", () => {
    const root = Frame.open(fnNode({ fn: "a" }), { params: { temperature: 1, maxOutputTokens: 9 } });
    const child = root.child(fnNode({ fn: "b" }), { params: { temperature: 0 } });
    expect(child.resolveParams()).toEqual({ temperature: 0, maxOutputTokens: 9 });
    // Definition site reads the static chain, independent of who called.
    expect(root.child(fnNode({ fn: "c" }, "b.tsi")).sourceFile()).toBe("b.tsi");
  });

  it("toTrace is JSON-safe", () => {
    const frame = Frame.open(fnNode());
    frame.openAsk({ askId: "a1", site: new Site("x.tsi", "1:1") }).close();
    expect(() => JSON.stringify(frame.toTrace())).not.toThrow();
  });

  it("runtime is reachable through the frame (via the static node)", () => {
    const frame = Frame.open(fnNode());
    expect(frame.runtime).toBe(nolaRuntime.current());
  });
});
