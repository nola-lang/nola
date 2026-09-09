import type { ClassicPrompt, InferRequest, ProviderPayload, ProviderRequest } from "@nola-lang/core";
import { isInferenceModel, PLATFORM_MODEL } from "@nola-lang/core";
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
          complete: async (req) => {
            seen.push((req.payload as ClassicPrompt).messages.map((m) => m.content));
            return { text: seen.length === 1 ? "123" : '"ok"' };
          },
        },
      },
    });
    const v = await askViaInference({ frame: openTestFrame(), prompt: "p", schema: { type: "string" }, loc: "1:1" });
    expect(v).toBe("ok");
    // Second call: [original user, assistant echo, correction user].
    expect(seen[1]).toHaveLength(3);
    expect(seen[1]?.[2]).toBe(
      "Your previous reply was invalid: $: expected string, got number. Reply again with JSON strictly conforming to responseSchema.",
    );
  });

  it("rejects non-JSON replies with the parse error", async () => {
    nolaRuntime.configure({
      model: { default: { name: "raw", complete: async () => ({ text: "not json" }) } },
    });
    await expect(
      askViaInference({ frame: openTestFrame(), prompt: "p", schema: { type: "string" }, loc: "3:7" }),
    ).rejects.toThrow(/reply is not valid JSON/);
  });

  it("sends the ask identity as trace and the merged params", async () => {
    let got: ProviderRequest | undefined;
    nolaRuntime.configure({
      model: {
        default: {
          name: "cap",
          complete: async (req) => {
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
    expect((got?.payload as ClassicPrompt).messages[0]?.content).toContain("<request>\np\n</request>");
  });

  it("hands an unbranded provider the classic rendering, on the first attempt and on the correction", async () => {
    const seen: ProviderPayload[] = [];
    nolaRuntime.configure({
      model: {
        default: {
          name: "custom",
          complete: async (req) => {
            seen.push(req.payload);
            return { text: seen.length === 1 ? "123" : '"ok"' };
          },
        },
      },
    });
    await expect(askViaInference({ frame: openTestFrame(), prompt: "p", schema: { type: "string" }, loc: "1:1" })).resolves.toBe("ok");
    expect(seen.map(isInferenceModel)).toEqual([false, false]);
    expect((seen[0] as ClassicPrompt).messages).toHaveLength(1);
    expect((seen[1] as ClassicPrompt).messages).toHaveLength(3);
    expect((seen[1] as ClassicPrompt).messages[1]).toEqual({ role: "assistant", content: "123" });
  });

  it("dispatches infer(req.model) to a managed provider — no payload key, model carries the correction", async () => {
    const seen: InferRequest[] = [];
    const managed = {
      [PLATFORM_MODEL]: true as const,
      name: "m",
      infer: async (req: InferRequest) => {
        seen.push(req);
        return { text: seen.length === 1 ? "123" : '"ok"' };
      },
    };
    nolaRuntime.configure({ model: managed as never });
    await expect(
      askViaInference({ frame: openTestFrame(), prompt: "p", schema: { type: "string" }, loc: "1:1" }),
    ).resolves.toBe("ok");
    expect(seen.map((r) => isInferenceModel(r.model))).toEqual([true, true]);
    expect(seen.map((r) => "payload" in r)).toEqual([false, false]);
    expect(seen[0]?.model.input.instruction).toBe("p");
    expect(seen[1]?.model.correction).toEqual({ response: "123", error: "$: expected string, got number" });
    expect(seen[0]?.trace?.askId).toEqual(expect.any(String));
  });

  it("a managed ask carries the config project; a classic request does not; the fingerprint ignores it", async () => {
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
    let classicReq: ProviderRequest | undefined;
    nolaRuntime.configure({
      model: { default: { name: "c", complete: async (req: ProviderRequest) => { classicReq = req; return { text: '"x"' }; } } },
      project: "proj-c",
    });
    await askViaInference({ frame: openTestFrame(), prompt: "p", schema: { type: "string" }, loc: "1:1" });
    expect("project" in (classicReq as object)).toBe(false);
  });

  it("managed and classic asks over the same source share one fingerprint (record/replay parity)", async () => {
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

  it("the onProviderRequest hook event carries the payload as sent but never the abort signal", async () => {
    let event: unknown;
    nolaRuntime.configure({
      model: { default: mockProvider(["Evgen"]) },
      telemetry: [{ onProviderRequest: (e) => { event = e; } }],
    });
    await askViaInference({ frame: openTestFrame(), prompt: "user name", schema: { type: "string" }, loc: "1:1" });
    expect("signal" in (event as object)).toBe(false);
    expect("model" in (event as object)).toBe(false);
    const payload = (event as { payload?: ProviderPayload }).payload;
    expect(payload && !isInferenceModel(payload) && payload.messages[0]?.content).toContain("user name");
  });
});
