import type { InferenceModel } from "@nola-lang/core";
import { isToolModel } from "@nola-lang/core";
import { google } from "@nola-lang/providers";
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

// Tool use on Gemini (spec 2026-10-08 §3.6): function calling cannot mix with
// JSON response mode, so the answer is the `nola_answer` function and the
// calling mode is ANY; function calls carry no ids, so the provider mints
// them and answers results by name.
describe("google — tool use", () => {
  it("is a tool model; sends function declarations plus the answer function in ANY mode, and no generationConfig", async () => {
    const { fn, calls } = fakeFetch(() => ({
      body: { candidates: [{ content: { parts: [{ text: "Looking." }, { functionCall: { name: "fs_readFile", args: { path: "a" } } }] } }] },
    }));
    const p = google({ apiKey: "k", fetch: fn, model: "m" });
    expect(isToolModel(p)).toBe(true);
    const res = await p.infer({ intent: intent() });
    expect(res.toolCalls).toEqual([{ id: expect.any(String), name: "fs_readFile", args: { path: "a" } }]);
    expect(res.text).toBe("Looking.");
    const sent = body(calls);
    expect(sent.tools).toEqual([
      {
        functionDeclarations: [
          { name: "fs_readFile", description: "Read a file.", parametersJsonSchema: parameters },
          { name: "nola_answer", description: expect.stringContaining("answer"), parametersJsonSchema: transport },
        ],
      },
    ]);
    expect(sent.toolConfig).toEqual({ functionCallingConfig: { mode: "ANY" } });
    expect(sent.generationConfig).toBeUndefined();
  });

  it("the answer function's args are the answer, unwrapped from the envelope", async () => {
    const { fn } = fakeFetch(() => ({
      body: { candidates: [{ content: { parts: [{ functionCall: { name: "nola_answer", args: { value: ["a"] } } }] } }] },
    }));
    const res = await google({ apiKey: "k", fetch: fn, model: "m" }).infer({ intent: intent() });
    expect(res.text).toBe('["a"]');
    expect(res.toolCalls).toBeUndefined();
  });

  it("sends the transcript natively — functionCall and functionResponse parts — between the task and the correction", async () => {
    const { fn, calls } = fakeFetch(() => ({
      body: { candidates: [{ content: { parts: [{ functionCall: { name: "nola_answer", args: { value: ["a"] } } }] } }] },
    }));
    await google({ apiKey: "k", fetch: fn, model: "m" }).infer({
      intent: intent({
        transcript: [{ text: "Looking.", calls: [{ id: "c1", name: "fs_readFile", args: { path: "a" }, result: "contents" }] }],
        correction: { response: "[1]", error: "expected strings" },
      }),
    });
    expect(body(calls).contents).toEqual([
      { role: "user", parts: [{ text: "<task>\nfind the visa files\n</task>" }] },
      { role: "model", parts: [{ text: "Looking." }, { functionCall: { name: "fs_readFile", args: { path: "a" } } }] },
      { role: "user", parts: [{ functionResponse: { name: "fs_readFile", response: { result: "contents" } } }] },
      { role: "model", parts: [{ text: "[1]" }] },
      { role: "user", parts: [{ text: "<correction>\nexpected strings\n</correction>" }] },
    ]);
  });

  it("structuredOutputs: false — no answer function, AUTO mode, a text reply (in the envelope the system turn asks for) is the answer", async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { candidates: [{ content: { parts: [{ text: '{"value":["a"]}' }] } }] } }));
    const res = await google({ apiKey: "k", fetch: fn, model: "m", structuredOutputs: false }).infer({ intent: intent() });
    expect(res.text).toBe('["a"]');
    const sent = body(calls);
    expect(sent.tools[0].functionDeclarations.map((t: { name: string }) => t.name)).toEqual(["fs_readFile"]);
    expect(sent.toolConfig).toEqual({ functionCallingConfig: { mode: "AUTO" } });
  });
});

// `toolUse` beside `structuredOutputs`: false leaves the model unbranded, a
// strategy is recorded on the model (see openai-tools.test.ts for the rules).
describe("google — toolUse", () => {
  it("toolUse: false leaves the model unbranded; a strategy is recorded on the model", () => {
    const off = google({ apiKey: "k", model: "m", toolUse: false });
    expect(isToolModel(off)).toBe(false);
    expect(off.toolUse).toBe(false);
    expect(google({ apiKey: "k", model: "m", toolUse: "native" }).toolUse).toBe("native");
  });
});
