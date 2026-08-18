import type { AskReceipt } from "@nola-lang/core";
import { mockProvider } from "@nola-lang/providers";
import { ExtractInferContext, ExtractIntent, Frame, fingerprintRequest, nolaRuntime, PromptBuilder, SYSTEM_PREAMBLE } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { openTestFrame } from "./helpers/frame.js";
import { askViaInference } from "./helpers/inference.js";

afterEach(() => nolaRuntime.reset());

const ctx = () => openTestFrame({ data: { fn: "go", instruction: "be careful" } });

describe("JsonInference", () => {
  it("returns the validated value and sends the composed context", async () => {
    let seen = "";
    nolaRuntime.configure({
      providers: {
        default: {
          name: "probe",
          complete: async (req) => {
            seen = req.messages[0]?.content ?? "";
            return { text: '"Evgen"' };
          },
        },
      },
    });
    const c = ctx();
    c.history.push({ prompt: "earlier", value: 7 });
    const v = await askViaInference({
      frame: c,
      prompt: "user name",
      schema: { type: "string" },
      loc: "1:1",
    });
    expect(v).toBe("Evgen");
    expect(seen).toContain("CONTEXT — inside go(), x.tsi");
    expect(seen).toContain("Purpose: be careful");
    expect(seen).toContain("<request>\nuser name\n</request>");
    // TODO(history): assert the "earlier" record once history composition lands.
  });

  it("retries once with the validation error, then succeeds", async () => {
    // mock JSON-stringifies each value: first yields `123` (fails string validation), then `"ok"`.
    nolaRuntime.configure({ providers: { default: mockProvider([123, "ok"]) } });
    const v = await askViaInference({
      frame: ctx(),
      prompt: "p",
      schema: { type: "string" },
      loc: "1:1",
    });
    expect(v).toBe("ok");
  });

  it("throws NolaResolutionError after the second failure", async () => {
    // both yields are strings — fail number validation twice.
    nolaRuntime.configure({ providers: { default: mockProvider(["nope", "still nope"]) } });
    await expect(
      askViaInference({ frame: ctx(), prompt: "p", schema: { type: "number" }, loc: "3:7" }),
    ).rejects.toThrow(/x\.tsi:3:7/);
  });

  it("routes through the pin argument", async () => {
    nolaRuntime.configure({
      providers: {
        default: mockProvider(["wrong"]),
        probe: { name: "probe", complete: async () => ({ text: '"routed"' }) },
      },
    });
    const value = await askViaInference({
      frame: Frame.open(nolaRuntime.current().fileContext("t.tsi")),
      prompt: "p",
      schema: { type: "string" },
      loc: "1:1",
      pin: "probe",
    });
    expect(value).toBe("routed");
  });

  it("an invocation frame's pin covers callee asks (chain lookup)", async () => {
    nolaRuntime.configure({
      providers: {
        default: mockProvider(["wrong"]),
        probe: { name: "probe", complete: async () => ({ text: '"routed"' }) },
      },
    });
    const infer = nolaRuntime.current().fileContext("t.tsi").scope({ fn: "go" });
    const value = await askViaInference({
      frame: Frame.open(infer, { provider: "probe" }),
      prompt: "p",
      schema: { type: "string" },
      loc: "1:1",
    });
    expect(value).toBe("routed");
  });
});

describe("JsonInference span recording", () => {
  it("receipt carries invocationId + spanPath from the active frame and per-attempt data lands on the trace", async () => {
    const receipts: AskReceipt[] = [];
    nolaRuntime.configure({
      providers: { default: mockProvider([123, "ok"]) }, // first attempt fails string validation
      hooks: [{ name: "cap", onAskEnd: (e) => receipts.push(e.receipt) }],
    });
    const frame = Frame.open(nolaRuntime.current().fileContext("x.tsi").scope({ fn: "go" }));
    const v = await askViaInference({
      frame,
      prompt: "p",
      schema: { type: "string" },
      loc: "1:1",
    });
    expect(v).toBe("ok");
    expect(receipts[0]?.invocationId).toBe(frame.invocationId);
    expect(receipts[0]?.spanPath).toEqual([frame.invocationId]);
    const trace = frame.toTrace();
    expect(trace.spans).toHaveLength(1);
    const span = trace.spans[0];
    if (span?.kind !== "ask") throw new Error("expected ask span");
    expect(span.attempts).toHaveLength(2);
    expect(span.attempts[0]?.validationError).toMatch(/expected string/i);
    expect(span.attempts[1]?.validationError).toBeUndefined();
    expect(span.servedBy).toBe("mock");
    expect(span.outcome).toEqual({ ok: true, value: "ok" });
  });

  it("with no frame (bare thenable await), the ask never starts: no receipt, a definitive NolaIntentError", async () => {
    const receipts: AskReceipt[] = [];
    nolaRuntime.configure({
      providers: { default: mockProvider(["ok"]) },
      hooks: [{ name: "cap", onAskEnd: (e) => receipts.push(e.receipt) }],
    });
    await expect(new ExtractIntent({ instruction: "p", type: { type: "string" }, loc: "1:1" })).rejects.toMatchObject({
      name: "NolaIntentError",
    });
    expect(receipts).toEqual([]);
  });

  it("stamps a request fingerprint on the receipt; a different prompt changes it", async () => {
    const receipts: AskReceipt[] = [];
    const hook = { name: "cap", onAskEnd: (e: { receipt: AskReceipt }) => receipts.push(e.receipt) };
    nolaRuntime.configure({ providers: { default: mockProvider(["a", "b"]) }, hooks: [hook] });
    await askViaInference({ frame: ctx(), prompt: "p", schema: { type: "string" }, loc: "1:1" });
    await askViaInference({ frame: ctx(), prompt: "q", schema: { type: "string" }, loc: "1:1" });

    expect(receipts[0]?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(receipts[1]?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(receipts[1]?.fingerprint).not.toBe(receipts[0]?.fingerprint);
  });

  it("sends the composed system text; the system node never enters the lineage JSON", async () => {
    let captured: { system: string; content: string } | undefined;
    nolaRuntime.configure({
      providers: {
        default: {
          name: "cap",
          complete: async (req) => {
            captured = { system: req.system, content: req.messages[0]?.content ?? "" };
            return { text: '"ok"' };
          },
        },
      },
      system: { message: "Be terse." },
    });
    const infer = nolaRuntime.current().fileContext("x.tsi").func({ fn: "go", instruction: "" });
    const frame = Frame.open(infer);
    await askViaInference({ frame, prompt: "p", schema: { type: "string" }, loc: "1:1" });
    expect(captured?.system).toBe(`${SYSTEM_PREAMBLE}\n\nBe terse.`);
    expect(captured?.content).toContain("CONTEXT — inside go(), x.tsi");
    // The system text never leaks into the user message.
    expect(captured?.content).not.toContain(SYSTEM_PREAMBLE);
    expect(captured?.content).not.toContain("Be terse.");
  });

  it("identical composed requests fingerprint identically (deterministic composition)", () => {
    const mk = () => {
      const runtime = nolaRuntime.current();
      const frame = Frame.open(runtime.fileContext("x.tsi").func({ fn: "go", instruction: "" }));
      const extract = frame.child(
        new ExtractInferContext({ instruction: "p", type: { type: "string" }, loc: "1:1" }, runtime),
      );
      const { messages, schema } = new PromptBuilder().build(extract);
      return fingerprintRequest({
        system: runtime.system.systemText(),
        messages,
        output: { syntax: "json", schema },
      });
    };
    expect(mk()).toBe(mk());
  });

  it("attaches the ask span to the passed frame", async () => {
    nolaRuntime.configure({ providers: { default: mockProvider(["ok"]) } });
    const frame = Frame.open(nolaRuntime.current().fileContext("x.tsi").scope({ fn: "go" }));
    const v = await askViaInference({
      frame,
      prompt: "p",
      schema: { type: "string" },
      loc: "1:1",
    });
    expect(v).toBe("ok");
    expect(frame.toTrace().spans).toHaveLength(1);
  });
});
