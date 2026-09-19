import { type ClassicPrompt, type InvocationEndEvent, type InvocationStartEvent, NOLA_EMIT } from "@nola-lang/core";
import { mockProvider } from "@nola-lang/providers";
import type { Frame } from "@nola-lang/runtime";
import { __nola, NolaVersionError, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => nolaRuntime.reset());

/** What lowering emits for the module body: `__nola_file_ctx().module({...})`. */
const moduleCtx = (file = "main.tsi") => __nola.context.file(file).module({});

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

  it("a bare module scope contributes no CONTEXT block — the prompt is the plain TASK", async () => {
    const payloads: string[] = [];
    nolaRuntime.configure({
      model: {
        default: {
          name: "probe",
          complete: async (req) => {
            payloads.push((req.payload as ClassicPrompt).messages[0]?.content ?? "");
            return { text: '"x"' };
          },
        },
      },
    });
    await __nola.ask(extract(), moduleCtx());
    expect(payloads[0]).not.toContain("CONTEXT");
    expect(payloads[0]).toContain("Produce the data requested below.");
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
        __nola.context.file("main.tsi").func({ fn: "label", instruction: "" }),
      );
    await expect(__nola.ask(fn(), moduleCtx())).resolves.toBe("v");
    expect(starts.map((s) => s.fn)).toEqual(["<module>", "label"]);
    expect(starts[1]?.parentInvocationId).toBe(starts[0]?.invocationId);
  });

  it("the asked intent's timeout is the <module> root's clock — it can exceed ask.timeoutMs", async () => {
    nolaRuntime.configure({
      model: {
        default: { name: "slow", complete: () => new Promise((r) => setTimeout(() => r({ text: '"late"' }), 80)) },
      },
      ask: { timeoutMs: 20 },
    });
    await expect(__nola.ask(extract().withTimeout(2_000), moduleCtx())).resolves.toBe("late");
  });

  it("the module node is memoized per file", () => {
    expect(moduleCtx("a.tsi")).toBe(moduleCtx("a.tsi"));
    expect(moduleCtx("a.tsi")).not.toBe(moduleCtx("b.tsi"));
  });
});

describe("the file accessor checks the emit contract", () => {
  it("a matching contract passes, a skewed one fails at the first accessor call", () => {
    expect(() => __nola.context.file("x.tsi", NOLA_EMIT)).not.toThrow();
    expect(() => __nola.context.file("x.tsi", NOLA_EMIT - 1)).toThrow(NolaVersionError);
  });
});
