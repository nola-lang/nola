import type { AskReceipt, NolaHook } from "@nola-lang/core";
import { mockProvider } from "@nola-lang/providers";
import { Frame, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { openTestFrame } from "./helpers/frame.js";
import { askViaInference } from "./helpers/inference.js";

afterEach(() => nolaRuntime.reset());

const ctx = () => openTestFrame();

function recorder() {
  const events: string[] = [];
  const receipts: AskReceipt[] = [];
  const hook: NolaHook = {
    name: "rec",
    onAskStart: () => events.push("askStart"),
    onProviderRequest: (e) => events.push(`providerRequest:${e.attempt}`),
    onProviderResponse: (e) => events.push(`providerResponse:${e.attempt}`),
    onValidationFailed: (e) => events.push(`validationFailed:${e.attempt}`),
    onRetry: (e) => events.push(`retry:${e.attempt}`),
    onAskEnd: (e) => {
      events.push("askEnd");
      receipts.push(e.receipt);
    },
  };
  return { events, receipts, hook };
}

const ask = (schema: { type: "string" } | { type: "number" }) =>
  askViaInference({ frame: ctx(), prompt: "user name", schema, loc: "3:7" });

describe("ask events", () => {
  it("emits the happy-path sequence and a successful receipt", async () => {
    const { events, receipts, hook } = recorder();
    nolaRuntime.configure({ providers: { default: mockProvider(["Evgen"]) }, hooks: [hook] });

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
    expect(receipt.originalPrompt).toContain("<request>\nuser name\n</request>");
    expect(receipt.effectivePrompt).toBe(receipt.originalPrompt);
    expect(receipt.askId).toMatch(/\S/);
    expect(typeof receipt.durationMs).toBe("number");
  });

  it("emits validationFailed + retry, and counts both attempts", async () => {
    const { events, receipts, hook } = recorder();
    nolaRuntime.configure({ providers: { default: mockProvider([123, "ok"]) }, hooks: [hook] });

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
    expect(receipts[0]?.effectivePrompt).toContain("Your previous reply was invalid");
  });

  it("emits askEnd with a failed outcome when both attempts fail, then throws", async () => {
    const { events, receipts, hook } = recorder();
    nolaRuntime.configure({ providers: { default: mockProvider(["nope", "still nope"]) }, hooks: [hook] });

    await expect(ask({ type: "number" })).rejects.toThrow(/x\.tsi:3:7/);

    expect(events.at(-1)).toBe("askEnd");
    const outcome = receipts[0]?.outcome as { ok: false; error: string };
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/x\.tsi:3:7/);
  });

  it("emits askEnd with a failed outcome when the provider itself throws", async () => {
    const { events, receipts, hook } = recorder();
    nolaRuntime.configure({
      providers: {
        default: {
          name: "boom",
          complete: async () => {
            throw new Error("network down, key sk-proj-AbCd1234EfGh5678IjKl");
          },
        },
      },
      hooks: [hook],
    });

    await expect(ask({ type: "string" })).rejects.toThrow(/network down/);

    expect(events).toEqual(["askStart", "providerRequest:1", "askEnd"]);
    const outcome = receipts[0]?.outcome as { ok: false; error: string };
    expect(outcome.ok).toBe(false);
    expect(outcome.error).not.toMatch(/AbCd1234/); // redacted into the receipt
  });

  it("reports the routed provider in the receipt", async () => {
    const { receipts, hook } = recorder();
    nolaRuntime.configure({
      providers: { default: mockProvider(["d"]), fast: mockProvider(["f"]) },
      hooks: [hook],
    });
    await askViaInference({
      frame: Frame.open(nolaRuntime.current().fileContext("x.tsi")),
      prompt: "p",
      schema: { type: "string" },
      loc: "1:1",
      pin: "fast",
    });
    expect(receipts[0]?.servedBy).toBe("mock"); // mockProvider's name
  });
});
