import { isToolModel } from "@nola-lang/core";
import { mockProvider, toolCalls } from "@nola-lang/providers";
import { describe, expect, it } from "vitest";
import { modelOf } from "./helpers/model.js";

// mockProvider's tool-use scripting (spec 2026-10-08 §3.6): `{ tools: true }`
// brands it, and a `toolCalls([...])` value — from the queue or the callback —
// is a tool turn; any other value is an answer, as before.
describe("mockProvider — tool turns", () => {
  it("a toolCalls value is a tool turn with ids minted; the next value answers", async () => {
    const model = mockProvider([toolCalls([{ name: "search", args: { dir: "D:/" } }]), "done"], { tools: true });
    expect(isToolModel(model)).toBe(true);
    const req = { intent: modelOf({ schema: { type: "string" } }) };
    const first = await model.infer(req);
    expect(first.text).toBe("");
    expect(first.toolCalls).toEqual([{ id: expect.any(String), name: "search", args: { dir: "D:/" } }]);
    const second = await model.infer(req);
    expect(second).toEqual({ text: '"done"' });
  });

  it("keeps a given id; the callback form works the same", async () => {
    const model = mockProvider(() => toolCalls([{ id: "c1", name: "a", args: {} }]), { tools: true });
    const res = await model.infer({ intent: modelOf({ schema: { type: "string" } }) });
    expect(res.toolCalls).toEqual([{ id: "c1", name: "a", args: {} }]);
  });

  it("without the option the mock is not a tool model, and an answer that merely has a toolCalls key stays an answer", async () => {
    const model = mockProvider([{ toolCalls: [1] }]);
    expect(isToolModel(model)).toBe(false);
    expect(await model.infer({ intent: modelOf({ schema: { type: "object" } }) })).toEqual({ text: '{"toolCalls":[1]}' });
  });
});
