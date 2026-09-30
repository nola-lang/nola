import { renderPrompt } from "@nola-lang/core";
import { mockProvider } from "@nola-lang/providers";
import type { Frame } from "@nola-lang/runtime";
import { __nola, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => nolaRuntime.reset());

/** Simulates lowered infer functions a() and b(), b asked inside a. */
function lowered() {
  const fileCtx = nolaRuntime.current().moduleContext("x.tsi");
  const b = () =>
    __nola.intents.Intent(
      async (__ctx: Frame) => {
        const inner = await __nola.ask(
          __nola.intents.ExtractIntent({ instruction: "inner", type: { type: "string" }, loc: "5:3" }),
          __ctx,
        );
        return { inner };
      },
      fileCtx.func({ fn: "b" }),
    );
  const a = () =>
    __nola.intents.Intent(
      async (__ctx: Frame) => {
        const first = await __nola.ask(
          __nola.intents.ExtractIntent({ instruction: "first", type: { type: "string" }, loc: "2:3" }),
          __ctx,
        );
        const fromB = await __nola.ask(b(), __ctx);
        return { first, fromB };
      },
      fileCtx.func({ fn: "a" }),
    );
  return { a, b };
}

describe("stack-frame semantics", () => {
  it("callee sees caller history and lineage; result composes", async () => {
    const payloads: string[] = [];
    nolaRuntime.configure({
      model: {
        default: {
          name: "probe",
          infer: async (req) => {
            payloads.push(renderPrompt(req.intent).messages[0]?.content ?? "");
            return { text: JSON.stringify(`v${payloads.length}`) };
          },
        },
      },
    });
    const { a } = lowered();
    const result = await a();
    expect(result).toEqual({ first: "v1", fromB: { inner: "v2" } });

    // b's lineage descends from a's node: caller context first, callee marked as nested.
    const bPayload = payloads[1] ?? "";
    expect(bPayload).toContain('<context function="a"/>');
    expect(bPayload).toContain('<context function="b"/>');
    expect(bPayload.indexOf('function="a"')).toBeLessThan(bPayload.indexOf('function="b"'));
    // TODO(history): assert b's prompt carries a's "first" extraction once history composition lands.
  });

  it("caller history gets one collapsed record for the callee, not the callee's internals", async () => {
    nolaRuntime.configure({ model: { default: mockProvider(["v1"]) } });
    const fileCtx = nolaRuntime.current().moduleContext("x.tsi");
    let callerHistory: unknown;
    const b = () =>
      __nola.intents.Intent(
        async (__ctx: Frame) => {
          return await __nola.ask(
            __nola.intents.ExtractIntent({ instruction: "inner", type: { type: "string" }, loc: "5:3" }),
            __ctx,
          );
        },
        fileCtx.func({ fn: "b" }),
      );
    const a = () =>
      __nola.intents.Intent(
        async (__ctx: Frame) => {
          await __nola.ask(b(), __ctx);
          callerHistory = [...__ctx.history];
          return null;
        },
        fileCtx.func({ fn: "a" }),
      );
    await a();
    expect(callerHistory).toEqual([{ prompt: "b", value: "v1" }]);
  });

  it("callee ask spans nest one frame deeper than the caller's own ask", async () => {
    const spanPaths: (readonly string[] | undefined)[] = [];
    nolaRuntime.configure({
      model: { default: mockProvider(["v1", "v2"]) },
      telemetry: [{ name: "cap", onAskEnd: (e) => spanPaths.push(e.receipt.spanPath) }],
    });
    const { a } = lowered();
    await a();
    expect(spanPaths[0]).toHaveLength(1); // a's own extract ask
    expect(spanPaths[1]).toHaveLength(2); // b's ask, nested one frame deep
  });

  it("await from plain TS still roots from the file context (no active frame)", async () => {
    nolaRuntime.configure({ model: { default: mockProvider(["v1"]) } });
    const { b } = lowered();
    const result = await b();
    expect(result).toEqual({ inner: "v1" });
  });

  it(".detached() roots from the file context even inside a caller frame", async () => {
    const payloads: string[] = [];
    nolaRuntime.configure({
      model: {
        default: {
          name: "probe",
          infer: async (req) => {
            payloads.push(renderPrompt(req.intent).messages[0]?.content ?? "");
            return { text: JSON.stringify(`v${payloads.length}`) };
          },
        },
      },
    });
    const fileCtx = nolaRuntime.current().moduleContext("x.tsi");
    const b = () =>
      __nola.intents.Intent(
        async (__ctx: Frame) => {
          return await __nola.ask(
            __nola.intents.ExtractIntent({ instruction: "inner", type: { type: "string" }, loc: "5:3" }),
            __ctx,
          );
        },
        fileCtx.func({ fn: "b" }),
      );
    const a = () =>
      __nola.intents.Intent(
        async (__ctx: Frame) => {
          await __nola.ask(
            __nola.intents.ExtractIntent({ instruction: "first", type: { type: "string" }, loc: "2:3" }),
            __ctx,
          );
          return await __nola.ask(b().detached(), __ctx);
        },
        fileCtx.func({ fn: "a" }),
      );
    await a();
    const bPayload = payloads[1] ?? "";
    expect(bPayload).toContain('<context function="b"/>'); // rooted at file, no caller block
    expect(bPayload).not.toContain('function="a"'); // no inherited caller context
  });
});
