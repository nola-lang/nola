import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatModel, InferModel, InferRequest, LanguageModel, ProviderRequest } from "@nola-lang/core";
import { DECISION_MODEL, isDecisionModel, isInferModel, renderClassic } from "@nola-lang/core";
import { constant, fallback, mockProvider, record, replay, roundRobin, withRetry } from "@nola-lang/providers";
import { describe, expect, it } from "vitest";
import { modelOf, requestOf } from "./helpers/model.js";

const chat = (name: string, text = "chat"): ChatModel => ({ name, complete: async () => ({ text }) });
const decider = (name: string, text = "decided"): ChatModel & { [DECISION_MODEL]: true } => ({
  name,
  complete: async () => ({ text }),
  [DECISION_MODEL]: true,
});
const inferer = (name: string, text = "inferred"): InferModel => ({ name, infer: async () => ({ text }) });
const decisionModel = modelOf({
  schema: { type: "number", minimum: 0, maximum: 1, "x-nola-decision": { kind: "prob" } },
});
const decisionReq: InferRequest = { model: decisionModel };
const decisionClassic: ProviderRequest = { payload: renderClassic(decisionModel) };
const plainClassic = requestOf();

describe("combinator dialect and brand", () => {
  it("all-chat inners: a chat combinator, no brand", () => {
    const f = fallback([chat("a"), chat("b")]);
    expect(isInferModel(f)).toBe(false);
    expect(isDecisionModel(f)).toBe(false);
    expect("complete" in f).toBe(true);
  });

  it("any infer inner: an infer combinator; chat inners get the rendering", async () => {
    let seen: ProviderRequest | undefined;
    const c: ChatModel = {
      name: "c",
      complete: async (req) => {
        seen = req;
        return { text: "c" };
      },
    };
    const down: InferModel = {
      name: "i",
      infer: async () => {
        throw new Error("down");
      },
    };
    const f = fallback([down as unknown as LanguageModel, c]);
    expect(isInferModel(f)).toBe(true);
    const res = await (f as unknown as InferModel).infer({ model: modelOf() });
    expect(res.text).toBe("c");
    expect(seen?.payload).toEqual(renderClassic(modelOf()));
  });

  it("any decision inner brands the combinator (fallback, roundRobin, withRetry)", () => {
    expect(isDecisionModel(fallback([chat("a"), decider("d")]))).toBe(true);
    expect(isDecisionModel(roundRobin([decider("d"), chat("a")]))).toBe(true);
    expect(isDecisionModel(withRetry(decider("d"), constant({ maxRetries: 1 })))).toBe(true);
    expect(isDecisionModel(withRetry(chat("a"), constant({ maxRetries: 1 })))).toBe(false);
  });

  it("fallback skips unbranded inners on a decision request and names them in the failure", async () => {
    const f = fallback([chat("a"), decider("d")]);
    expect((await (f as ChatModel).complete(decisionClassic)).text).toBe("decided");
    const dead = {
      name: "dead",
      complete: async () => {
        throw new Error("down");
      },
      [DECISION_MODEL]: true,
    } as LanguageModel;
    await expect((fallback([chat("a"), dead]) as ChatModel).complete(decisionClassic)).rejects.toThrow(
      /a: not a decision model\n {2}dead: down/,
    );
  });

  it("fallback on a plain request still tries every inner in order", async () => {
    const f = fallback([chat("a"), decider("d")]);
    expect((await (f as ChatModel).complete(plainClassic)).text).toBe("chat");
  });

  it("roundRobin skips unbranded inners on a decision request", async () => {
    const r = roundRobin([chat("a"), decider("d1", "one"), decider("d2", "two")]) as ChatModel;
    const texts = [
      await r.complete(decisionClassic),
      await r.complete(decisionClassic),
      await r.complete(decisionClassic),
    ].map((x) => x.text);
    expect(texts.every((t) => t === "one" || t === "two")).toBe(true);
    expect(new Set(texts).size).toBe(2);
  });

  it("withRetry mirrors an infer inner's dialect", async () => {
    let calls = 0;
    const flaky: InferModel = {
      name: "flaky",
      infer: async () => {
        calls++;
        if (calls < 2) throw new Error("net");
        return { text: "ok" };
      },
    };
    const r = withRetry(flaky as unknown as LanguageModel, constant({ maxRetries: 2 }));
    expect(isInferModel(r)).toBe(true);
    expect((await (r as unknown as InferModel).infer(decisionReq)).text).toBe("ok");
    expect(calls).toBe(2);
  });
});

describe("record / replay / mock", () => {
  it("record mirrors an infer inner and forwards the decision brand; replay is a decision model", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nola-dec-"));
    const ledger = join(dir, "l.jsonl");
    const inner = { ...inferer("i", JSON.stringify(0.7)), [DECISION_MODEL]: true } as unknown as LanguageModel;
    const rec = record(inner, ledger);
    expect(isInferModel(rec)).toBe(true);
    expect(isDecisionModel(rec)).toBe(true);
    expect((await (rec as unknown as InferModel).infer(decisionReq)).text).toBe("0.7");
    const rep = replay(ledger);
    expect(isDecisionModel(rep)).toBe(true);
    expect((await (rep as ChatModel).complete(decisionClassic)).text).toBe("0.7");
  });

  it("record over a chat inner forwards the brand and keeps complete", () => {
    const dir = mkdtempSync(join(tmpdir(), "nola-dec-"));
    const rec = record(decider("d"), join(dir, "l.jsonl"));
    expect(isInferModel(rec)).toBe(false);
    expect(isDecisionModel(rec)).toBe(true);
  });

  it("mockProvider is branded only with { decisions: true }", () => {
    expect(isDecisionModel(mockProvider(["x"]))).toBe(false);
    expect(isDecisionModel(mockProvider(["x"], { decisions: true }))).toBe(true);
    expect(isDecisionModel(mockProvider(() => 1, { decisions: true }))).toBe(true);
  });
});
