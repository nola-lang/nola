import type { InferenceModel } from "@nola-lang/core";
import { isToolModel } from "@nola-lang/core";
import { anthropic } from "@nola-lang/providers";
import { describe, expect, it } from "vitest";

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

const parameters = { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } as const;
const tools = [{ name: "fs.readFile", description: "Read a file.", parameters }];
const schema = { type: "array", items: { type: "string" } } as const;
const transport = { type: "object", properties: { value: schema }, required: ["value"], additionalProperties: false };
const intent = (extra: Partial<InferenceModel> = {}): InferenceModel => ({
  intent: "tool-use",
  input: { instruction: "find the visa files" },
  tools,
  output: { syntax: "json", schema },
  ...extra,
});
const body = (calls: FetchArgs[]) => JSON.parse(String(calls[0]?.init.body));

// Tool use on Anthropic (spec 2026-10-08 §3.6): the Messages API cannot mix
// its structured output with tools, so the answer is one more tool —
// `nola_answer`, carrying the output schema — and tool_choice `any` makes
// every turn a tool call: a real tool continues the loop, the answer tool
// ends it. The technique is invisible outside the provider.
describe("anthropic — tool use", () => {
  it("is a tool model; sends the tools plus the answer tool with tool_choice any, and no output_config", async () => {
    const { fn, calls } = fakeFetch(() => ({
      body: {
        content: [
          { type: "text", text: "Looking." },
          { type: "tool_use", id: "toolu_1", name: "fs_readFile", input: { path: "a" } },
        ],
      },
    }));
    const p = anthropic({ apiKey: "k", fetch: fn, model: "m" });
    expect(isToolModel(p)).toBe(true);
    const res = await p.infer({ intent: intent() });
    expect(res.toolCalls).toEqual([{ id: "toolu_1", name: "fs_readFile", args: { path: "a" } }]);
    expect(res.text).toBe("Looking.");
    const sent = body(calls);
    expect(sent.tools).toEqual([
      { name: "fs_readFile", description: "Read a file.", input_schema: parameters },
      { name: "nola_answer", description: expect.stringContaining("answer"), input_schema: transport },
    ]);
    expect(sent.tool_choice).toEqual({ type: "any" });
    expect(sent.output_config).toBeUndefined();
  });

  it("the answer tool's input is the answer, unwrapped from the envelope", async () => {
    const { fn } = fakeFetch(() => ({
      body: { content: [{ type: "tool_use", id: "toolu_2", name: "nola_answer", input: { value: ["a"] } }] },
    }));
    const res = await anthropic({ apiKey: "k", fetch: fn, model: "m" }).infer({ intent: intent() });
    expect(res.text).toBe('["a"]');
    expect(res.toolCalls).toBeUndefined();
  });

  it("an answer tool input without the envelope's value passes through as is for the runtime to report", async () => {
    const { fn } = fakeFetch(() => ({
      body: { content: [{ type: "tool_use", id: "toolu_2", name: "nola_answer", input: { other: 1 } }] },
    }));
    const res = await anthropic({ apiKey: "k", fetch: fn, model: "m" }).infer({ intent: intent() });
    expect(res.text).toBe('{"other":1}');
  });

  it("sends the transcript natively — tool_use and tool_result blocks — between the task and the correction", async () => {
    const { fn, calls } = fakeFetch(() => ({
      body: { content: [{ type: "tool_use", id: "t", name: "nola_answer", input: { value: ["a"] } }] },
    }));
    await anthropic({ apiKey: "k", fetch: fn, model: "m" }).infer({
      intent: intent({
        transcript: [{ text: "Looking.", calls: [{ id: "c1", name: "fs_readFile", args: { path: "a" }, result: "contents" }] }],
        correction: { response: "[1]", error: "expected strings" },
      }),
    });
    expect(body(calls).messages).toEqual([
      { role: "user", content: "<task>\nfind the visa files\n</task>" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Looking." },
          { type: "tool_use", id: "c1", name: "fs_readFile", input: { path: "a" } },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "contents" }] },
      { role: "assistant", content: "[1]" },
      { role: "user", content: "<correction>\nexpected strings\n</correction>" },
    ]);
  });

  it("structuredOutputs: false — no answer tool, tool_choice auto, a text reply (in the envelope the system turn asks for) is the answer", async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { content: [{ type: "text", text: '{"value":["a"]}' }] } }));
    const res = await anthropic({ apiKey: "k", fetch: fn, model: "m", structuredOutputs: false }).infer({ intent: intent() });
    expect(res.text).toBe('["a"]');
    const sent = body(calls);
    expect(sent.tools.map((t: { name: string }) => t.name)).toEqual(["fs_readFile"]);
    expect(sent.tool_choice).toEqual({ type: "auto" });
  });
});

// `toolUse` beside `structuredOutputs`: false leaves the model unbranded, a
// strategy is recorded on the model (see openai-tools.test.ts for the rules).
describe("anthropic — toolUse", () => {
  it("toolUse: false leaves the model unbranded; a strategy is recorded on the model", () => {
    const off = anthropic({ apiKey: "k", model: "m", toolUse: false });
    expect(isToolModel(off)).toBe(false);
    expect(off.toolUse).toBe(false);
    expect(anthropic({ apiKey: "k", model: "m", toolUse: "native" }).toolUse).toBe("native");
  });
});
