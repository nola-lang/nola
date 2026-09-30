import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InferRequest, LanguageModel } from "@nola-lang/core";
import { DECISION_MODEL, isDecisionModel } from "@nola-lang/core";
import { constant, fallback, mockProvider, record, replay, roundRobin, withRetry } from "@nola-lang/providers";
import { describe, expect, it } from "vitest";
import { modelOf, requestOf } from "./helpers/model.js";

const plain = (name: string, text = "chat"): LanguageModel => ({ name, infer: async () => ({ text }) });
const decider = (name: string, text = "decided"): LanguageModel & { [DECISION_MODEL]: true } => ({
  name,
  infer: async () => ({ text }),
  [DECISION_MODEL]: true,
});
const decisionModel = modelOf({
  schema: { type: "number", minimum: 0, maximum: 1, "x-nola-decision": { kind: "prob" } },
});
const decisionReq: InferRequest = { intent: decisionModel };
const plainReq = requestOf();

describe("combinator brand", () => {
  it("unbranded inners: no brand; every inner receives the intent as is", async () => {
    let seen: InferRequest | undefined;
    const c: LanguageModel = {
      name: "c",
      infer: async (req) => {
        seen = req;
        return { text: "c" };
      },
    };
    const down: LanguageModel = {
      name: "i",
      infer: async () => {
        throw new Error("down");
      },
    };
    const f = fallback([down, c]);
    expect(isDecisionModel(f)).toBe(false);
    const res = await f.infer({ intent: modelOf() });
    expect(res.text).toBe("c");
    expect(seen?.intent).toEqual(modelOf());
  });

  it("any decision inner brands the combinator (fallback, roundRobin, withRetry)", () => {
    expect(isDecisionModel(fallback([plain("a"), decider("d")]))).toBe(true);
    expect(isDecisionModel(roundRobin([decider("d"), plain("a")]))).toBe(true);
    expect(isDecisionModel(withRetry(decider("d"), constant({ maxRetries: 1 })))).toBe(true);
    expect(isDecisionModel(withRetry(plain("a"), constant({ maxRetries: 1 })))).toBe(false);
  });

  it("fallback skips unbranded inners on a decision request and names them in the failure", async () => {
    const f = fallback([plain("a"), decider("d")]);
    expect((await f.infer(decisionReq)).text).toBe("decided");
    const dead = {
      name: "dead",
      infer: async () => {
        throw new Error("down");
      },
      [DECISION_MODEL]: true,
    } as LanguageModel;
    await expect(fallback([plain("a"), dead]).infer(decisionReq)).rejects.toThrow(/a: not a decision model\n {2}dead: down/);
  });

  it("fallback on a plain request still tries every inner in order", async () => {
    const f = fallback([plain("a"), decider("d")]);
    expect((await f.infer(plainReq)).text).toBe("chat");
  });

  it("roundRobin skips unbranded inners on a decision request", async () => {
    const r = roundRobin([plain("a"), decider("d1", "one"), decider("d2", "two")]);
    const texts = [await r.infer(decisionReq), await r.infer(decisionReq), await r.infer(decisionReq)].map((x) => x.text);
    expect(texts.every((t) => t === "one" || t === "two")).toBe(true);
    expect(new Set(texts).size).toBe(2);
  });

  it("withRetry forwards infer and retries a flaky inner", async () => {
    let calls = 0;
    const flaky: LanguageModel = {
      name: "flaky",
      infer: async () => {
        calls++;
        if (calls < 2) throw new Error("net");
        return { text: "ok" };
      },
    };
    const r = withRetry(flaky, constant({ maxRetries: 2 }));
    expect((await r.infer(decisionReq)).text).toBe("ok");
    expect(calls).toBe(2);
  });
});

describe("record / replay / mock", () => {
  it("record forwards the decision brand; replay is a decision model", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nola-dec-"));
    const ledger = join(dir, "l.jsonl");
    const rec = record(decider("i", JSON.stringify(0.7)), ledger);
    expect(isDecisionModel(rec)).toBe(true);
    expect((await rec.infer(decisionReq)).text).toBe("0.7");
    const rep = replay(ledger);
    expect(isDecisionModel(rep)).toBe(true);
    expect((await rep.infer(decisionReq)).text).toBe("0.7");
  });

  it("record over an unbranded inner stays unbranded", () => {
    const dir = mkdtempSync(join(tmpdir(), "nola-dec-"));
    expect(isDecisionModel(record(plain("p"), join(dir, "l.jsonl")))).toBe(false);
    expect(isDecisionModel(record(decider("d"), join(dir, "l2.jsonl")))).toBe(true);
  });

  it("mockProvider is branded only with { decisions: true }", () => {
    expect(isDecisionModel(mockProvider(["x"]))).toBe(false);
    expect(isDecisionModel(mockProvider(["x"], { decisions: true }))).toBe(true);
    expect(isDecisionModel(mockProvider(() => 1, { decisions: true }))).toBe(true);
  });
});

describe("a complete()-only inner is the retired chat dialect: rejected at construction, never a TypeError at the first ask", () => {
  const legacy = { name: "legacy", complete: async () => ({ text: '"x"' }) } as unknown as LanguageModel;
  const migration = /legacy.*implements complete\(req\).*infer\(req\).*renderPrompt\(\)/;

  it("withRetry, fallback and roundRobin name the migration", () => {
    expect(() => withRetry(legacy, constant({ maxRetries: 1 }))).toThrow(migration);
    expect(() => fallback([plain("ok"), legacy])).toThrow(migration);
    expect(() => roundRobin([legacy])).toThrow(migration);
  });

  it("record names the migration too, and a non-model inner is 'not a model'", () => {
    const dir = mkdtempSync(join(tmpdir(), "nola-legacy-"));
    expect(() => record(legacy, join(dir, "l.jsonl"))).toThrow(migration);
    expect(() => fallback([{ name: "nope" } as unknown as LanguageModel])).toThrow(/fallback\(nope\) is not a model \(need \{ name: string, infer\(req\) \}\)/);
  });
});
