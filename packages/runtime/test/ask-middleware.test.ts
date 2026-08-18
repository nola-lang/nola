import type { AskReceipt, NolaHook, NolaMiddleware } from "@nola-lang/core";
import { mockProvider } from "@nola-lang/providers";
import { nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openTestFrame } from "./helpers/frame.js";
import { askViaInference } from "./helpers/inference.js";

afterEach(() => nolaRuntime.reset());

const ctx = () => openTestFrame();
const ask = (frame = ctx()) => askViaInference({ frame, prompt: "user name", schema: { type: "string" }, loc: "1:1" });

function receiptHook() {
  const receipts: AskReceipt[] = [];
  const events: string[] = [];
  const hook: NolaHook = {
    name: "rec",
    onAskStart: () => events.push("askStart"),
    onProviderRequest: () => events.push("providerRequest"),
    onAskEnd: (e) => {
      events.push("askEnd");
      receipts.push(e.receipt);
    },
  };
  return { receipts, events, hook };
}

// TODO(middleware): the pipeline is deliberately unwired for v1 — runPipeline and the config
// section remain as infrastructure. Un-skip when the ask path re-enters the pipeline.
describe.skip("middleware in the ask path", () => {
  it("sees the prompt and can rewrite what the provider receives", async () => {
    let sent = "";
    const prefix: NolaMiddleware = async (c, next) => {
      c.prompt = `Be terse. ${c.prompt}`;
      return next(c);
    };
    nolaRuntime.configure({
      providers: {
        default: {
          name: "probe",
          complete: async (req) => {
            sent = JSON.parse(req.messages[0]?.content ?? "{}").request;
            return { text: '"ok"' };
          },
        },
      },
      middleware: [prefix],
    });
    await expect(ask()).resolves.toBe("ok");
    expect(sent).toBe("Be terse. user name");
  });

  it("records originalPrompt and effectivePrompt separately in the receipt", async () => {
    const { receipts, hook } = receiptHook();
    const prefix: NolaMiddleware = async (c, next) => {
      c.prompt = `Be terse. ${c.prompt}`;
      return next(c);
    };
    nolaRuntime.configure({ providers: { default: mockProvider(["ok"]) }, middleware: [prefix], hooks: [hook] });
    await ask();
    expect(receipts[0]).toMatchObject({ originalPrompt: "user name", effectivePrompt: "Be terse. user name" });
  });

  it("short-circuit: no provider call, askEnd still fires with servedBy=cache and attempts=0", async () => {
    const { receipts, events, hook } = receiptHook();
    const complete = vi.fn(async () => ({ text: '"never"' }));
    const cache: NolaMiddleware = async () => ({ value: "cached", servedBy: "cache" });
    nolaRuntime.configure({
      providers: { default: { name: "probe", complete } },
      middleware: [cache],
      hooks: [hook],
    });

    await expect(ask()).resolves.toBe("cached");

    expect(complete).not.toHaveBeenCalled();
    expect(events).toEqual(["askStart", "askEnd"]); // no providerRequest — truthful
    expect(receipts[0]).toMatchObject({ servedBy: "cache", attempts: 0, outcome: { ok: true, value: "cached" } });
  });

  it("a short-circuit value that violates the schema fails the ask", async () => {
    const bad: NolaMiddleware = async () => ({ value: 42, servedBy: "cache" });
    nolaRuntime.configure({ providers: { default: mockProvider(["x"]) }, middleware: [bad] });
    await expect(ask()).rejects.toThrow(/x\.tsi:1:1/);
  });

  it("a throwing middleware fails the ask and is reported in the receipt", async () => {
    const { receipts, hook } = receiptHook();
    const boom: NolaMiddleware = async () => {
      throw new Error("middleware exploded");
    };
    nolaRuntime.configure({ providers: { default: mockProvider(["x"]) }, middleware: [boom], hooks: [hook] });
    await expect(ask()).rejects.toThrow("middleware exploded");
    expect(receipts[0]?.outcome).toMatchObject({ ok: false });
  });

  it("middleware can re-route the provider, overriding a per-intent pin", async () => {
    const { receipts, hook } = receiptHook();
    const reroute: NolaMiddleware = async (c, next) => {
      c.provider = "slow";
      return next(c);
    };
    nolaRuntime.configure({
      providers: {
        default: mockProvider(["d"]),
        fast: { name: "fast", complete: async () => ({ text: '"from-fast"' }) },
        slow: { name: "slow", complete: async () => ({ text: '"from-slow"' }) },
      },
      middleware: [reroute],
      hooks: [hook],
    });
    const pinned = askViaInference({
      frame: ctx(),
      prompt: "user name",
      schema: { type: "string" },
      loc: "1:1",
      pin: "fast",
    });
    await expect(pinned).resolves.toBe("from-slow");
    expect(receipts[0]?.servedBy).toBe("slow");
  });

  it("forceProvider beats middleware re-routing (hermetic)", async () => {
    const { receipts, hook } = receiptHook();
    const reroute: NolaMiddleware = async (c, next) => {
      c.provider = "real";
      return next(c);
    };
    nolaRuntime.configure({
      providers: {
        default: mockProvider(["d"]),
        real: { name: "real", complete: async () => ({ text: '"from-real"' }) },
        mock: { name: "mock", complete: async () => ({ text: '"from-mock"' }) },
      },
      forceProvider: "mock",
      middleware: [reroute],
      hooks: [hook],
    });
    await expect(ask()).resolves.toBe("from-mock");
    expect(receipts[0]?.servedBy).toBe("mock");
  });

  it("exposes meta as cross-stage scratch that lands in the receipt", async () => {
    const { receipts, hook } = receiptHook();
    const tag: NolaMiddleware = async (c, next) => {
      c.meta.tenant = "acme";
      return next(c);
    };
    nolaRuntime.configure({ providers: { default: mockProvider(["ok"]) }, middleware: [tag], hooks: [hook] });
    await ask();
    expect(receipts[0]?.meta).toEqual({ tenant: "acme" });
  });

  it("middleware cannot mutate runtime-owned fields", async () => {
    const vandal: NolaMiddleware = async (c, next) => {
      (c as { schema: unknown }).schema = { type: "number" };
      return next(c);
    };
    nolaRuntime.configure({ providers: { default: mockProvider(["ok"]) }, middleware: [vandal] });
    await expect(ask()).rejects.toThrow(TypeError);
  });
});
