import type { AskReceipt, AskStartEvent, NolaTelemetry } from "@nola-lang/core";
import { renderPrompt } from "@nola-lang/core";
import { mockProvider } from "@nola-lang/providers";
import { ExtractIntent, Frame, nolaRuntime, inferTypes as t } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { openTestFrame } from "./helpers/frame.js";
import { askViaInference } from "./helpers/inference.js";

/** An obviously fake key that still has a real key's shape (nothing key-shaped is committed as a literal). */
const FAKE_KEY = `sk-proj-${"A".repeat(24)}`;

afterEach(() => nolaRuntime.reset());

const ctx = () => openTestFrame();

function recorder() {
  const events: string[] = [];
  const receipts: AskReceipt[] = [];
  const starts: AskStartEvent[] = [];
  const hook: NolaTelemetry = {
    name: "rec",
    onAskStart: (e) => {
      events.push("askStart");
      starts.push(e);
    },
    onProviderRequest: (e) => events.push(`providerRequest:${e.attempt}`),
    onProviderResponse: (e) => events.push(`providerResponse:${e.attempt}`),
    onValidationFailed: (e) => events.push(`validationFailed:${e.attempt}`),
    onRetry: (e) => events.push(`retry:${e.attempt}`),
    onAskEnd: (e) => {
      events.push("askEnd");
      receipts.push(e.receipt);
    },
  };
  return { events, receipts, starts, hook };
}

const ask = (schema: { type: "string" } | { type: "number" }) =>
  askViaInference({ frame: ctx(), prompt: "user name", schema, loc: "3:7" });

describe("ask events", () => {
  it("emits the happy-path sequence and a successful receipt", async () => {
    const { events, receipts, hook } = recorder();
    nolaRuntime.configure({ model: { default: mockProvider(["Evgen"]) }, telemetry: [hook] });

    await expect(ask({ type: "string" })).resolves.toBe("Evgen");

    expect(events).toEqual(["askStart", "providerRequest:1", "providerResponse:1", "askEnd"]);
    const receipt = receipts[0] as AskReceipt;
    expect(receipt).toMatchObject({
      site: { file: "x.tsi", loc: "3:7" },
      servedBy: "mock",
      attempts: 1,
      outcome: { ok: true, value: "Evgen" },
    });
    // The prompt pair carries the composed conversation; equal when no correction ran.
    expect(receipt.originalPrompt).toContain("<task>\nuser name\n</task>");
    expect(receipt.effectivePrompt).toBe(receipt.originalPrompt);
    expect(receipt.askId).toMatch(/\S/);
    expect(typeof receipt.durationMs).toBe("number");
  });

  it("emits validationFailed + retry, and counts both attempts", async () => {
    const { events, receipts, hook } = recorder();
    nolaRuntime.configure({ model: { default: mockProvider([123, "ok"]) }, telemetry: [hook] });

    await expect(ask({ type: "string" })).resolves.toBe("ok");

    expect(events).toEqual([
      "askStart",
      "providerRequest:1",
      "providerResponse:1",
      "validationFailed:1",
      "retry:1",
      "providerRequest:2",
      "providerResponse:2",
      "askEnd",
    ]);
    expect(receipts[0]?.attempts).toBe(2);
    // The correction restamped "as sent": the pair diverges and carries the correction text.
    expect(receipts[0]?.effectivePrompt).not.toBe(receipts[0]?.originalPrompt);
    expect(receipts[0]?.effectivePrompt).toContain("<correction>");
  });

  it("emits askEnd with a failed outcome when both attempts fail, then throws", async () => {
    const { events, receipts, hook } = recorder();
    nolaRuntime.configure({ model: { default: mockProvider(["nope", "still nope"]) }, telemetry: [hook] });

    await expect(ask({ type: "number" })).rejects.toThrow(/x\.tsi:3:7/);

    expect(events.at(-1)).toBe("askEnd");
    const outcome = receipts[0]?.outcome as { ok: false; error: string };
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/x\.tsi:3:7/);
  });

  it("emits askEnd with a failed outcome when the provider itself throws", async () => {
    const { events, receipts, hook } = recorder();
    nolaRuntime.configure({
      model: {
        default: {
          name: "boom",
          infer: async () => {
            throw new Error(`network down, key ${FAKE_KEY}`);
          },
        },
      },
      telemetry: [hook],
    });

    await expect(ask({ type: "string" })).rejects.toThrow(/network down/);

    expect(events).toEqual(["askStart", "providerRequest:1", "askEnd"]);
    const outcome = receipts[0]?.outcome as { ok: false; error: string };
    expect(outcome.ok).toBe(false);
    expect(outcome.error).not.toMatch(/AbCd1234/); // redacted into the receipt
  });

  it("def and instruction ride askStart; the receipt carries the same def", async () => {
    const { starts, receipts, hook } = recorder();
    nolaRuntime.configure({ model: { default: mockProvider(["Evgen"]) }, telemetry: [hook] });
    await expect(
      askViaInference({ frame: ctx(), prompt: "user name", schema: { type: "string" }, loc: "3:7", def: "d".repeat(64) }),
    ).resolves.toBe("Evgen");
    const start = starts[0] as AskStartEvent;
    expect(start.instruction).toBe("user name");
    expect(start.def).toBe("d".repeat(64));
    expect((receipts[0] as AskReceipt).def).toBe("d".repeat(64));
  });

  it("a def-less intent (hand-built) still asks, with no def on the events", async () => {
    const { starts, receipts, hook } = recorder();
    nolaRuntime.configure({ model: { default: mockProvider(["ok"]) }, telemetry: [hook] });
    await expect(ask({ type: "string" })).resolves.toBe("ok");
    expect((starts[0] as AskStartEvent).def).toBeUndefined();
    expect("def" in (receipts[0] as AskReceipt)).toBe(false);
  });

  it("askStart carries the frame's invocationId and spanPath, agreeing with the receipt", async () => {
    const { starts, receipts, hook } = recorder();
    nolaRuntime.configure({ model: { default: mockProvider(["Evgen"]) }, telemetry: [hook] });
    await expect(ask({ type: "string" })).resolves.toBe("Evgen");
    const start = starts[0] as AskStartEvent;
    const receipt = receipts[0] as AskReceipt;
    expect(start.invocationId).toBe(receipt.invocationId);
    expect(start.spanPath).toEqual(receipt.spanPath);
    expect(start.spanPath[0]).toBe(start.invocationId); // root ask: one-element path
  });

  it("reports the routed provider in the receipt", async () => {
    const { receipts, hook } = recorder();
    nolaRuntime.configure({
      model: { default: mockProvider(["d"]), fast: mockProvider(["f"]) },
      telemetry: [hook],
    });
    await askViaInference({
      frame: Frame.open(nolaRuntime.current().moduleContext("x.tsi")),
      prompt: "p",
      schema: { type: "string" },
      loc: "1:1",
      pin: "fast",
    });
    expect(receipts[0]?.servedBy).toBe("mock"); // mockProvider's name
  });

  it("on a correction the receipt's effectivePrompt is the three-turn echo of attempt 2 and the fingerprint is attempt 1's", async () => {
    const receipts: AskReceipt[] = [];
    let attempt = 0;
    nolaRuntime.configure({
      model: {
        default: {
          name: "probe",
          infer: async (req) => {
            attempt += 1;
            return { text: attempt === 1 ? "123" : '"ok"', sent: renderPrompt(req.intent) };
          },
        },
      },
      telemetry: [
        {
          onAskEnd: ({ receipt }) => {
            receipts.push(receipt);
          },
        },
      ],
    });
    await askViaInference({ frame: openTestFrame(), prompt: "p", schema: { type: "string" }, loc: "1:1" });
    const receipt = receipts[0] as AskReceipt;
    expect(receipt.attempts).toBe(2);
    expect(receipt.originalPrompt.split("\n\nassistant: ")).toHaveLength(1);
    expect(receipt.effectivePrompt).toContain("\n\nassistant: 123\n\nuser: ");
    // the identity is attempt 1's: fingerprintRequest strips the correction (pinned in Task 4); here only that a fingerprint is carried
    expect(receipt.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("when the correction attempt itself throws, effectivePrompt still shows the correction that was in flight", async () => {
    const receipts: AskReceipt[] = [];
    let attempt = 0;
    nolaRuntime.configure({
      model: {
        default: {
          name: "probe",
          infer: async () => {
            attempt += 1;
            if (attempt === 1) return { text: "123" };
            throw new Error("network down");
          },
        },
      },
      telemetry: [
        {
          onAskEnd: ({ receipt }) => {
            receipts.push(receipt);
          },
        },
      ],
    });
    await expect(askViaInference({ frame: openTestFrame(), prompt: "p", schema: { type: "string" }, loc: "1:1" })).rejects.toThrow(/network down/);
    expect(receipts[0]?.effectivePrompt).toContain("<correction>");
    expect(receipts[0]?.effectivePrompt).toContain("assistant: 123");
  });

  it("a provider that returns no echo leaves effectivePrompt as the default rendering, never empty", async () => {
    const receipts: AskReceipt[] = [];
    nolaRuntime.configure({
      model: { default: { name: "silent", infer: async () => ({ text: '"ok"' }) } },
      telemetry: [
        {
          onAskEnd: ({ receipt }) => {
            receipts.push(receipt);
          },
        },
      ],
    });
    await askViaInference({ frame: openTestFrame(), prompt: "p", schema: { type: "string" }, loc: "1:1" });
    expect(receipts[0]?.effectivePrompt).toBe(receipts[0]?.originalPrompt);
    expect(receipts[0]?.effectivePrompt.length).toBeGreaterThan(0);
  });
});

describe("ask identity", () => {
  it("askStart and the receipt carry kind: extract, and typeText for a named ref", async () => {
    const { starts, receipts, hook } = recorder();
    nolaRuntime.configure({ model: { default: mockProvider([{ id: "1" }]) }, telemetry: [hook] });
    const ticket = t.ref("Ticket", () => t.object({ id: t.string() }));
    await new ExtractIntent({ instruction: "the ticket", type: ticket, loc: "1:1" }, nolaRuntime.current()).run(ctx());
    expect(starts[0]).toMatchObject({ kind: "extract", instruction: "the ticket", typeText: "Ticket" });
    expect(starts[0]?.callee).toBeUndefined();
    expect(receipts[0]?.kind).toBe("extract");
  });

  it("an anonymous carrier type renders its TypeScript; a raw JSON-schema type has no typeText", async () => {
    const { starts, hook } = recorder();
    nolaRuntime.configure({ model: { default: mockProvider(["quote", "x"]) }, telemetry: [hook] });
    await new ExtractIntent(
      { instruction: "order or quote?", type: t.enum(["quote", "order"]), loc: "1:1" },
      nolaRuntime.current(),
    ).run(ctx());
    expect(starts[0]).toMatchObject({ kind: "extract", typeText: '"quote" | "order"' });
    await ask({ type: "string" });
    expect(starts[1]?.kind).toBe("extract");
    expect(starts[1]?.typeText).toBeUndefined();
  });
});
