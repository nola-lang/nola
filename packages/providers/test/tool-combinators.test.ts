import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InferRequest, LanguageModel } from "@nola-lang/core";
import { isToolModel, TOOL_MODEL } from "@nola-lang/core";
import { constant, fallback, mockProvider, record, replay, roundRobin, toolCalls, withRetry } from "@nola-lang/providers";
import { describe, expect, it } from "vitest";
import { modelOf, requestOf } from "./helpers/model.js";

const plain = (name: string, text = "chat"): LanguageModel => ({ name, infer: async () => ({ text }) });
const tooler = (name: string, text = "tooled"): LanguageModel & { [TOOL_MODEL]: true } => ({
  name,
  infer: async () => ({ text }),
  [TOOL_MODEL]: true,
});
const toolReq: InferRequest = {
  intent: {
    ...modelOf(),
    intent: "tool-use",
    tools: [{ name: "a", parameters: { type: "object", properties: {}, required: [], additionalProperties: false } }],
  },
};
const plainReq = requestOf();

// The tool brand's combinator rules mirror the decision brand's (spec
// 2026-10-08 §3.6): any branded inner brands the outer; fallback and
// roundRobin skip unbranded inners on a tool-use request; record carries
// the inner's brand; replay is branded and serves recorded tool calls.
describe("TOOL_MODEL through combinators", () => {
  it("any tool inner brands the combinator (fallback, roundRobin, withRetry)", () => {
    expect(isToolModel(fallback([plain("a"), tooler("t")]))).toBe(true);
    expect(isToolModel(roundRobin([tooler("t"), plain("a")]))).toBe(true);
    expect(isToolModel(withRetry(tooler("t"), constant({ maxRetries: 1 })))).toBe(true);
    expect(isToolModel(withRetry(plain("a"), constant({ maxRetries: 1 })))).toBe(false);
    expect(isToolModel(fallback([plain("a"), plain("b")]))).toBe(false);
  });

  it("fallback and roundRobin skip unbranded inners on a tool-use request, and name the reason when all are skipped", async () => {
    const f = fallback([plain("a"), tooler("t")]);
    expect((await f.infer(toolReq)).text).toBe("tooled");
    expect((await f.infer(plainReq)).text).toBe("chat");
    const r = roundRobin([plain("a"), tooler("t")]);
    expect((await r.infer(toolReq)).text).toBe("tooled");
    expect((await r.infer(toolReq)).text).toBe("tooled");
    await expect(fallback([plain("a"), plain("b")]).infer(toolReq)).rejects.toThrow(/not a tool model/);
  });

  it("record carries the brand and stores tool calls; replay is branded and serves them", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "nola-tool-ledger-")), "ledger.jsonl");
    const inner = mockProvider([toolCalls([{ id: "c1", name: "a", args: { x: 1 } }]), "done"], { tools: true });
    const rec = record(inner, path);
    expect(isToolModel(rec)).toBe(true);
    expect(isToolModel(record(mockProvider(["x"]), path))).toBe(false);
    const first = await rec.infer(toolReq);
    expect(first.toolCalls).toEqual([{ id: "c1", name: "a", args: { x: 1 } }]);
    const second = await rec.infer({ intent: { ...toolReq.intent, transcript: [{ calls: [{ id: "c1", name: "a", args: { x: 1 }, result: "1" }] }] } });
    expect(second.text).toBe('"done"');
    const lines = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0].response).toEqual({ text: "", toolCalls: [{ id: "c1", name: "a", args: { x: 1 } }] });
    expect(lines[1].response).toEqual({ text: '"done"' });

    const rep = replay(path);
    expect(isToolModel(rep)).toBe(true);
    expect(await rep.infer(toolReq)).toEqual({ text: "", toolCalls: [{ id: "c1", name: "a", args: { x: 1 } }] });
    expect(
      await rep.infer({ intent: { ...toolReq.intent, transcript: [{ calls: [{ id: "c1", name: "a", args: { x: 1 }, result: "1" }] }] } }),
    ).toEqual({ text: '"done"' });
  });
});

// The strategy travels with the brand: a combinator carries the strategy its
// branded inners agree on (false and absent are "no strategy", so a host
// without tool use sits in a group beside a native one), and a group whose
// members name different strategies is refused at construction — the runtime
// picks the loop before it knows which member will serve.
describe("toolUse through combinators", () => {
  const native = (name: string): LanguageModel => ({ ...tooler(name), toolUse: "native" });

  it("withRetry, record, fallback and roundRobin carry the inners' strategy", () => {
    expect(withRetry(native("t"), constant({ maxRetries: 1 })).toolUse).toBe("native");
    expect(fallback([plain("a"), native("t")]).toolUse).toBe("native");
    expect(roundRobin([native("t"), tooler("u")]).toolUse).toBe("native");
    expect(fallback([{ ...plain("off"), toolUse: false }, native("t")]).toolUse).toBe("native");
    expect(fallback([plain("a"), tooler("t")]).toolUse).toBeUndefined();
    const path = join(mkdtempSync(join(tmpdir(), "nola-tool-mode-")), "ledger.jsonl");
    expect(record(native("t"), path).toolUse).toBe("native");
  });

  it("a group whose members name different strategies is refused at construction (NOLA3003)", () => {
    const other: LanguageModel = { ...tooler("o"), toolUse: "code" as unknown as "native" };
    expect(() => fallback([native("t"), other])).toThrow(/toolUse/);
    expect(() => roundRobin([other, native("t")])).toThrow(/toolUse/);
  });
});
