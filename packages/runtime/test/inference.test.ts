import type { InferenceModel, InferRequest, RenderedPrompt } from "@nola-lang/core";
import { PLATFORM_MODEL, renderPrompt } from "@nola-lang/core";
import { mockProvider } from "@nola-lang/providers";
import { nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { openTestFrame } from "./helpers/frame.js";
import { askViaInference } from "./helpers/inference.js";

afterEach(() => nolaRuntime.reset());

// There is no strategy-selection layer for now — each intent constructs its
// Inference directly (ExtractIntent/FunctionCallIntent → JsonInference).

describe("JsonInference.infer", () => {
  it("resolves the validated value", async () => {
    nolaRuntime.configure({ model: { default: mockProvider(["Evgen"]) } });
    await expect(
      askViaInference({ frame: openTestFrame(), prompt: "user name", schema: { type: "string" }, loc: "1:1" }),
    ).resolves.toBe("Evgen");
  });

  it("retries once with the correction prompt, then succeeds", async () => {
    const seen: string[][] = [];
    nolaRuntime.configure({
      model: {
        default: {
          name: "probe",
          infer: async (req) => {
            seen.push(renderPrompt(req.intent).messages.map((m) => m.content));
            return { text: seen.length === 1 ? "123" : '"ok"' };
          },
        },
      },
    });
    const v = await askViaInference({ frame: openTestFrame(), prompt: "p", schema: { type: "string" }, loc: "1:1" });
    expect(v).toBe("ok");
    // Second call: [original user, assistant echo, correction user].
    expect(seen[1]).toHaveLength(3);
    expect(seen[1]?.[2]).toBe("<correction>\n$: expected string, got number\n</correction>");
  });

  it("rejects non-JSON replies with the parse error", async () => {
    nolaRuntime.configure({
      model: { default: { name: "raw", infer: async () => ({ text: "not json" }) } },
    });
    await expect(
      askViaInference({ frame: openTestFrame(), prompt: "p", schema: { type: "string" }, loc: "3:7" }),
    ).rejects.toThrow(/reply is not valid JSON/);
  });

  it("sends the ask identity as trace and the merged params", async () => {
    let got: InferRequest | undefined;
    nolaRuntime.configure({
      model: {
        default: {
          name: "cap",
          infer: async (req) => {
            got = req;
            return { text: '"ok"' };
          },
        },
      },
    });
    const frame = openTestFrame({ options: { params: { temperature: 0.2 } } });
    await askViaInference({ frame, prompt: "p", schema: { type: "string" }, loc: "1:1" });
    expect(got?.trace).toEqual({ askId: expect.any(String), invocationId: frame.invocationId, spanPath: [frame.invocationId] });
    expect(got?.params).toEqual({ temperature: 0.2 });
    expect(renderPrompt(got?.intent as InferenceModel).messages[0]?.content).toContain("<task>\np\n</task>");
  });

  it("every model receives infer({ intent }) — the correction rides on the intent, never a rendering", async () => {
    const seen: InferRequest[] = [];
    nolaRuntime.configure({
      model: {
        default: {
          name: "custom",
          infer: async (req) => {
            seen.push(req);
            return { text: seen.length === 1 ? "123" : '"ok"' };
          },
        },
      },
    });
    await expect(askViaInference({ frame: openTestFrame(), prompt: "p", schema: { type: "string" }, loc: "1:1" })).resolves.toBe("ok");
    expect(seen.map((r) => "payload" in r)).toEqual([false, false]);
    expect(seen[0]?.intent.input.instruction).toBe("p");
    expect(seen[0]?.intent.correction).toBeUndefined();
    expect(seen[1]?.intent.correction).toEqual({ response: "123", error: "$: expected string, got number" });
    expect(seen[0]?.trace?.askId).toEqual(expect.any(String));
  });

  it("a platform ask carries the config project; an unbranded model's request does not; the fingerprint ignores it", async () => {
    const seen: InferRequest[] = [];
    const fps: (string | undefined)[] = [];
    const capture = { name: "cap", onAskEnd: (e: { receipt: { fingerprint?: string } }) => fps.push(e.receipt.fingerprint) };
    const managed = {
      [PLATFORM_MODEL]: true as const,
      name: "m",
      infer: async (req: InferRequest) => {
        seen.push(req);
        return { text: '"x"' };
      },
    };
    nolaRuntime.configure({ model: managed as never, project: "proj-a", telemetry: [capture as never] });
    await askViaInference({ frame: openTestFrame(), prompt: "p", schema: { type: "string" }, loc: "1:1" });
    expect(seen[0]?.project).toBe("proj-a");
    nolaRuntime.reset();
    nolaRuntime.configure({ model: managed as never, project: "proj-b", telemetry: [capture as never] });
    await askViaInference({ frame: openTestFrame(), prompt: "p", schema: { type: "string" }, loc: "1:1" });
    expect(seen[1]?.project).toBe("proj-b");
    // deployment metadata, not ask identity: different projects, one fingerprint
    expect(fps[0]).toBe(fps[1]);
    nolaRuntime.reset();
    let plainReq: InferRequest | undefined;
    nolaRuntime.configure({
      model: {
        default: {
          name: "c",
          infer: async (req: InferRequest) => {
            plainReq = req;
            return { text: '"x"' };
          },
        },
      },
      project: "proj-c",
    });
    await askViaInference({ frame: openTestFrame(), prompt: "p", schema: { type: "string" }, loc: "1:1" });
    expect("project" in (plainReq as object)).toBe(false);
  });

  it("platform and unbranded asks over the same source share one fingerprint (record/replay parity)", async () => {
    const fps: (string | undefined)[] = [];
    const capture = { name: "cap", onAskEnd: (e: { receipt: { fingerprint?: string } }) => fps.push(e.receipt.fingerprint) };
    const managed = { [PLATFORM_MODEL]: true as const, name: "m", infer: async () => ({ text: '"x"' }) };
    nolaRuntime.configure({ model: managed as never, telemetry: [capture as never] });
    await askViaInference({ frame: openTestFrame(), prompt: "user name", schema: { type: "string" }, loc: "1:1" });
    nolaRuntime.reset();
    nolaRuntime.configure({ model: mockProvider(["x"]), telemetry: [capture as never] });
    await askViaInference({ frame: openTestFrame(), prompt: "user name", schema: { type: "string" }, loc: "1:1" });
    expect(fps[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(fps[1]).toBe(fps[0]);
  });

  it("onProviderRequest carries the intent (never the abort signal); onProviderResponse carries the provider's echo", async () => {
    const events: { request?: unknown; response?: unknown } = {};
    const echo: RenderedPrompt = { system: "custom system", messages: [{ role: "user", content: "custom turn" }] };
    nolaRuntime.configure({
      model: { default: { name: "echoing", infer: async () => ({ text: '"Evgen"', sent: echo }) } },
      telemetry: [
        {
          onProviderRequest: (e) => {
            events.request = e;
          },
          onProviderResponse: (e) => {
            events.response = e;
          },
        },
      ],
    });
    await askViaInference({ frame: openTestFrame(), prompt: "user name", schema: { type: "string" }, loc: "1:1" });
    expect("signal" in (events.request as object)).toBe(false);
    expect("payload" in (events.request as object)).toBe(false);
    expect((events.request as { intent: InferenceModel }).intent.input.instruction).toBe("user name");
    expect((events.response as { sent?: RenderedPrompt }).sent).toEqual(echo);
  });

  it("the receipt's effectivePrompt is the provider's echo when it sends one, the default rendering otherwise", async () => {
    const receipts: { originalPrompt: string; effectivePrompt: string }[] = [];
    const echo: RenderedPrompt = { system: "s", messages: [{ role: "user", content: "what the provider really sent" }] };
    nolaRuntime.configure({
      model: {
        default: { name: "echoing", infer: async () => ({ text: '"x"', sent: echo }) },
        silent: { name: "silent", infer: async () => ({ text: '"x"' }) },
      },
      telemetry: [
        {
          onAskEnd: ({ receipt }) => {
            receipts.push(receipt);
          },
        },
      ],
    });
    await askViaInference({ frame: openTestFrame(), prompt: "user name", schema: { type: "string" }, loc: "1:1" });
    await askViaInference({ frame: openTestFrame(), prompt: "user name", schema: { type: "string" }, loc: "1:1", pin: "silent" });
    expect(receipts[0]?.effectivePrompt).toBe("user: what the provider really sent");
    expect(receipts[0]?.originalPrompt).toContain("user name");
    expect(receipts[1]?.effectivePrompt).toBe(receipts[1]?.originalPrompt);
    expect(receipts[1]?.effectivePrompt).toContain("user name");
  });
});
