import { type InvocationEndEvent, type InvocationStartEvent, NOLA_EMIT, renderPrompt } from "@nola-lang/core";
import { mockProvider } from "@nola-lang/providers";
import type { Frame } from "@nola-lang/runtime";
import { __nola, NolaVersionError, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";
// internal — the runtime index does not re-export the item reader
import { readItems } from "../src/infer-context/index.js";

afterEach(() => nolaRuntime.reset());

/** What lowering emits for the module body: `__nola_module_ctx()` → `__nola.context.module(file, emit, init?)`. */
const moduleCtx = (file = "main.tsi") => __nola.context.module(file);

const extract = (instruction = "a label") =>
  __nola.intents.ExtractIntent<string>({ instruction, type: { type: "string" }, loc: "1:15" });

describe("module-body ask (scope-bodies spec §3)", () => {
  it("runs an extractor on a <module> root invocation the runtime opens", async () => {
    const starts: InvocationStartEvent[] = [];
    const ends: InvocationEndEvent[] = [];
    nolaRuntime.configure({
      model: { default: mockProvider(["billing"]) },
      telemetry: [{ name: "cap", onInvocationStart: (e) => starts.push(e), onInvocationEnd: (e) => ends.push(e) }],
    });
    await expect(__nola.ask(extract(), moduleCtx())).resolves.toBe("billing");
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ fn: "<module>", file: "main.tsi", detached: false });
    expect(starts[0]?.parentInvocationId).toBeUndefined();
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ status: "ok", invocationId: starts[0]?.invocationId });
    expect(ends[0]?.trace.spans).toHaveLength(1);
  });

  it("opens one root per ask", async () => {
    const starts: InvocationStartEvent[] = [];
    nolaRuntime.configure({
      model: { default: mockProvider(["a", "b"]) },
      telemetry: [{ name: "cap", onInvocationStart: (e) => starts.push(e) }],
    });
    await __nola.ask(extract(), moduleCtx());
    await __nola.ask(extract(), moduleCtx());
    expect(new Set(starts.map((s) => s.invocationId)).size).toBe(2);
  });

  it("a bare module scope contributes no context block — the prompt is the task alone", async () => {
    const payloads: string[] = [];
    nolaRuntime.configure({
      model: {
        default: {
          name: "probe",
          infer: async (req) => {
            payloads.push(renderPrompt(req.intent).messages[0]?.content ?? "");
            return { text: '"x"' };
          },
        },
      },
    });
    await __nola.ask(extract(), moduleCtx());
    expect(payloads[0]).not.toContain("<context");
    expect(payloads[0]).toBe("<task>\na label\n</task>");
  });

  it("`ask fn()` chains the callee under the <module> frame", async () => {
    const starts: InvocationStartEvent[] = [];
    nolaRuntime.configure({
      model: { default: mockProvider(["v"]) },
      telemetry: [{ name: "cap", onInvocationStart: (e) => starts.push(e) }],
    });
    const fn = () =>
      __nola.intents.Intent(
        async (__frame: Frame) => __nola.ask(extract(), __frame),
        __nola.context.module("main.tsi").func({ fn: "label" }),
      );
    await expect(__nola.ask(fn(), moduleCtx())).resolves.toBe("v");
    expect(starts.map((s) => s.fn)).toEqual(["<module>", "label"]);
    expect(starts[1]?.parentInvocationId).toBe(starts[0]?.invocationId);
  });

  it("the asked intent's timeout is the <module> root's clock — it can exceed ask.timeoutMs", async () => {
    nolaRuntime.configure({
      model: {
        default: { name: "slow", infer: () => new Promise((r) => setTimeout(() => r({ text: '"late"' }), 80)) },
      },
      ask: { timeoutMs: 20 },
    });
    await expect(__nola.ask(extract().withTimeout(2_000), moduleCtx())).resolves.toBe("late");
  });

  it("the module node is memoized per file", () => {
    expect(moduleCtx("a.tsi")).toBe(moduleCtx("a.tsi"));
    expect(moduleCtx("a.tsi")).not.toBe(moduleCtx("b.tsi"));
  });

  it("the init thunk is read once, on creation — a later caller's thunk is ignored", () => {
    let reads = 0;
    const first = __nola.context.module("m.tsi", undefined, () => {
      reads += 1;
      return { context: [() => "first"] };
    });
    const again = __nola.context.module("m.tsi", undefined, () => {
      reads += 1;
      return { context: [() => "second"] };
    });
    expect(again).toBe(first);
    expect(reads).toBe(1);
    expect(readItems(first.data.context)).toBe("first");
  });

  it("func() parents a function scope under the module node, which answers the source file", () => {
    const mod = __nola.context.module("m.tsi");
    const fn = mod.func({ fn: "go" });
    expect(fn.parent).toBe(mod);
    expect(fn.sourceFile()).toBe("m.tsi");
    expect(mod.sourceFile()).toBe("m.tsi");
  });

  it("after nolaRuntime.reset() the next accessor call rebuilds the node from its thunk", () => {
    const before = __nola.context.module("m.tsi", undefined, () => ({ context: [() => "kept"] }));
    nolaRuntime.reset();
    const after = __nola.context.module("m.tsi", undefined, () => ({ context: [() => "kept"] }));
    expect(after).not.toBe(before);
    expect(readItems(after.data.context)).toBe("kept");
  });
});

describe("the module accessor checks the emit contract", () => {
  it("a matching contract passes, a skewed one fails at the first accessor call", () => {
    expect(() => __nola.context.module("x.tsi", NOLA_EMIT)).not.toThrow();
    expect(() => __nola.context.module("x.tsi", NOLA_EMIT - 1)).toThrow(NolaVersionError);
  });
});
