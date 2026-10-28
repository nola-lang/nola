import type { NolaInferResponse } from "@nola-lang/core";
import { isToolModel } from "@nola-lang/core";
import { describe, expect, it } from "vitest";
import { platformModel } from "../src/platform-model.js";
import { requestOf } from "./helpers/model.js";

type FetchArgs = { url: string; init: RequestInit };

function fakeFetch(reply: (args: FetchArgs) => { status?: number; body: unknown }) {
  const calls: FetchArgs[] = [];
  const fn = (async (url: unknown, init: unknown) => {
    const args = { url: String(url), init: init as RequestInit };
    calls.push(args);
    const { status = 200, body } = reply(args);
    return new Response(JSON.stringify(body), { status });
  }) as typeof globalThis.fetch;
  return { fn, calls };
}

// The platform serves tool use (spec 2026-10-08 §3.6, platform handoff
// 2026-10-08): the intent carries tools and the transcript as it is, and the
// reply may carry toolCalls beside the text.
describe("platform model — tool use", () => {
  it("is a tool model and passes a reply's toolCalls through", async () => {
    const reply: NolaInferResponse = { text: "", toolCalls: [{ id: "c1", name: "search", args: { dir: "D:/" } }] };
    const { fn, calls } = fakeFetch(() => ({ body: reply }));
    const p = platformModel({ apiKey: "k", fetch: fn });
    expect(isToolModel(p)).toBe(true);
    const intent = {
      ...requestOf().intent,
      intent: "tool-use" as const,
      tools: [{ name: "search", parameters: { type: "object" as const, properties: {}, required: [], additionalProperties: false } }],
    };
    const res = await p.infer({ intent });
    expect(res.toolCalls).toEqual([{ id: "c1", name: "search", args: { dir: "D:/" } }]);
    expect(res.text).toBe("");
    expect(JSON.parse(String(calls[0]?.init.body)).intent.tools).toEqual(intent.tools);
  });

  it("a reply without toolCalls is the answer, as before", async () => {
    const { fn } = fakeFetch(() => ({ body: { text: '"x"' } }));
    const res = await platformModel({ apiKey: "k", fetch: fn }).infer({ intent: requestOf().intent });
    expect(res).toEqual({ text: '"x"', durationMs: expect.any(Number) });
  });
});
