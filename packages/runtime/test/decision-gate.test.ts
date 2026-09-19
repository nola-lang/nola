import { Codes } from "@nola-lang/ast";
import { DECISION_MODEL, type InferRequest, type LanguageModel } from "@nola-lang/core";
import { mockProvider } from "@nola-lang/providers";
import { type AskEndEvent, nolaRuntime, inferTypes as t } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { openTestFrame } from "./helpers/frame.js";
import { askViaInference } from "./helpers/inference.js";

afterEach(() => nolaRuntime.reset());

const triage = t.object({ department: t.choice({ billing: "Payments", sales: null }) }).toJsonSchema();
const answer = { department: { choice: "billing", probabilities: { billing: 0.9, sales: 0.1 }, confidence: 0.9 } };

describe("NOLA3018: a decision ask needs a decision model", () => {
  it("refuses before the network on an unbranded chat model, names the path and the model, still emits askEnd", async () => {
    let calls = 0;
    const seen: AskEndEvent[] = [];
    const chat: LanguageModel = {
      name: "chatty",
      complete: async () => {
        calls++;
        return { text: JSON.stringify(answer) };
      },
    };
    nolaRuntime.configure({ model: { default: chat }, telemetry: [{ onAskEnd: (e) => seen.push(e) }] });
    await expect(
      askViaInference({ frame: openTestFrame(), prompt: "triage", schema: triage, loc: "1:1" }),
    ).rejects.toMatchObject({
      name: "NolaIntentError",
      code: Codes.DecisionModelRequired,
      message: expect.stringContaining(
        'output property "department" is a Choice; model "chatty" cannot answer decision questions',
      ),
    });
    expect(calls).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.receipt.outcome.ok).toBe(false);
  });

  it("a plain ask on the same model is unaffected", async () => {
    nolaRuntime.configure({ model: { default: mockProvider(["hello"]) } });
    await expect(
      askViaInference({ frame: openTestFrame(), prompt: "p", schema: { type: "string" }, loc: "1:1" }),
    ).resolves.toBe("hello");
  });

  it("a branded chat model serves it", async () => {
    const branded: LanguageModel & { [DECISION_MODEL]: true } = {
      name: "decider",
      complete: async () => ({ text: JSON.stringify(answer) }),
      [DECISION_MODEL]: true,
    };
    nolaRuntime.configure({ model: { default: branded } });
    await expect(
      askViaInference({ frame: openTestFrame(), prompt: "triage", schema: triage, loc: "1:1" }),
    ).resolves.toEqual(answer);
  });

  it("a user infer-dialect model receives the InferenceModel, no profile, no project", async () => {
    let received: InferRequest | undefined;
    const inferModel = {
      name: "structured",
      infer: async (req: InferRequest) => {
        received = req;
        return { text: JSON.stringify(answer) };
      },
      [DECISION_MODEL]: true,
    };
    nolaRuntime.configure({ model: { default: inferModel as unknown as LanguageModel }, project: "demo" });
    await expect(
      askViaInference({ frame: openTestFrame(), prompt: "triage", schema: triage, loc: "1:1" }),
    ).resolves.toEqual(answer);
    expect(received?.model.intent).toBe("extract");
    expect(received?.model.input.instruction).toBe("triage");
    expect(received?.model.output).toEqual({ syntax: "json", schema: triage });
    expect("profile" in (received ?? {})).toBe(false);
    expect("project" in (received ?? {})).toBe(false);
  });

  it("the plain-form union and boolean stay portable to any model", async () => {
    const plain = t.object({ team: t.enum(["a", "b"]), urgent: t.boolean() }).toJsonSchema();
    nolaRuntime.configure({ model: { default: mockProvider([{ team: "a", urgent: true }]) } });
    await expect(
      askViaInference({ frame: openTestFrame(), prompt: "p", schema: plain, loc: "1:1" }),
    ).resolves.toEqual({ team: "a", urgent: true });
  });
});
