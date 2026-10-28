import { Codes } from "@nola-lang/ast";
import type { InferenceModel, JsonSchema } from "@nola-lang/core";
import { isToolModel, NolaConfigError, renderPrompt } from "@nola-lang/core";
import { openai } from "@nola-lang/providers";
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
const intent = (extra: Partial<InferenceModel> = {}): InferenceModel => ({
  intent: "tool-use",
  input: { instruction: "find the visa files" },
  tools,
  output: { syntax: "json", schema: { type: "array", items: { type: "string" } } },
  ...extra,
});
const body = (calls: FetchArgs[]) => JSON.parse(String(calls[0]?.init.body));

// Tool use on OpenAI (spec 2026-10-08 §3.6, amended 2026-10-09): tools ride
// as strict function definitions under their wire names, the answer is ONE
// MORE strict function carrying the (enveloped) output schema, tool_choice is
// `required` and no response_format goes out — OpenAI-compatible hosts
// (Cerebras, Groq) reject tools beside response_format, and strict function
// calling gives OpenAI itself the same schema guarantee. A reply's tool_calls
// become InferResult.toolCalls; the transcript is sent natively.
describe("openai — tool use", () => {
  it("is a tool model; sends the tools and the answer tool as strict functions with tool_choice required and no response_format; reads tool_calls back", async () => {
    const { fn, calls } = fakeFetch(() => ({
      body: {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ id: "call_1", type: "function", function: { name: "fs_readFile", arguments: '{"path":"a"}' } }],
            },
          },
        ],
      },
    }));
    const p = openai({ apiKey: "k", fetch: fn, model: "m" });
    expect(isToolModel(p)).toBe(true);
    const res = await p.infer({ intent: intent() });
    expect(res.toolCalls).toEqual([{ id: "call_1", name: "fs_readFile", args: { path: "a" } }]);
    expect(res.text).toBe("");
    const sent = body(calls);
    expect(sent.tools).toEqual([
      { type: "function", function: { name: "fs_readFile", description: "Read a file.", strict: true, parameters } },
      {
        type: "function",
        function: {
          name: "nola_answer",
          description: expect.stringContaining("final answer"),
          strict: true,
          parameters: {
            type: "object",
            properties: { value: { type: "array", items: { type: "string" } } },
            required: ["value"],
            additionalProperties: false,
          },
        },
      },
    ]);
    expect(sent.tool_choice).toBe("required");
    expect(sent.response_format).toBeUndefined();
  });

  it("sends the transcript natively — an assistant tool_calls message and tool messages — between the task and the correction; a lone answer call is the answer", async () => {
    const { fn, calls } = fakeFetch(() => ({
      body: {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ id: "call_9", type: "function", function: { name: "nola_answer", arguments: '{"value":["a"]}' } }],
            },
          },
        ],
      },
    }));
    const req = {
      intent: intent({
        transcript: [{ text: "Looking.", calls: [{ id: "c1", name: "fs_readFile", args: { path: "a" }, result: "contents" }] }],
        correction: { response: "[1]", error: "expected strings" },
      }),
    };
    const res = await openai({ apiKey: "k", fetch: fn, model: "m" }).infer(req);
    expect(res.text).toBe('["a"]');
    expect(res.toolCalls).toBeUndefined();
    const messages = body(calls).messages as unknown[];
    expect(messages.slice(1)).toEqual([
      { role: "user", content: "<task>\nfind the visa files\n</task>" },
      {
        role: "assistant",
        content: "Looking.",
        tool_calls: [{ id: "c1", type: "function", function: { name: "fs_readFile", arguments: '{"path":"a"}' } }],
      },
      { role: "tool", tool_call_id: "c1", content: "contents" },
      { role: "assistant", content: "[1]" },
      { role: "user", content: "<correction>\nexpected strings\n</correction>" },
    ]);
    // the echo is the text rendering of the same intent
    expect(res.sent?.messages).toEqual(renderPrompt(req.intent).messages);
  });

  it("a content reply is the answer, as without tools; unparsable tool arguments pass through as the raw string", async () => {
    const answer = fakeFetch(() => ({ body: { choices: [{ message: { content: '{"value":["a","b"]}' } }] } }));
    const res = await openai({ apiKey: "k", fetch: answer.fn, model: "m" }).infer({ intent: intent() });
    expect(res.text).toBe('["a","b"]');
    expect(res.toolCalls).toBeUndefined();
    const broken = fakeFetch(() => ({
      body: { choices: [{ message: { content: "", tool_calls: [{ id: "c", type: "function", function: { name: "fs_readFile", arguments: "{oops" } }] } }] },
    }));
    const res2 = await openai({ apiKey: "k", fetch: broken.fn, model: "m" }).infer({ intent: intent() });
    expect(res2.toolCalls).toEqual([{ id: "c", name: "fs_readFile", args: "{oops" }]);
  });

  it("real tool calls beside an answer call are a turn; the answer call is dropped, as on the other vendors", async () => {
    const { fn } = fakeFetch(() => ({
      body: {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: "c1", type: "function", function: { name: "nola_answer", arguments: '{"value":["a"]}' } },
                { id: "c2", type: "function", function: { name: "fs_readFile", arguments: '{"path":"b"}' } },
              ],
            },
          },
        ],
      },
    }));
    const res = await openai({ apiKey: "k", fetch: fn, model: "m" }).infer({ intent: intent() });
    expect(res.toolCalls).toEqual([{ id: "c2", name: "fs_readFile", args: { path: "b" } }]);
    expect(res.text).toBe("");
  });

  it("the answer tool's schema is the strict transport, and the answer comes back through the strict-null cleanup", async () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { a: { type: "string" }, b: { type: "string" } },
      required: ["a"],
      additionalProperties: false,
    };
    const { fn, calls } = fakeFetch(() => ({
      body: {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ id: "c1", type: "function", function: { name: "nola_answer", arguments: '{"a":"x","b":null}' } }],
            },
          },
        ],
      },
    }));
    const res = await openai({ apiKey: "k", fetch: fn, model: "m" }).infer({ intent: intent({ output: { syntax: "json", schema } }) });
    expect(res.text).toBe('{"a":"x"}');
    const answer = body(calls).tools[1].function.parameters;
    expect(answer.required).toEqual(["a", "b"]);
    expect(answer.properties.b).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] });
  });

  it("an answer call whose arguments lack the envelope's value passes the raw arguments through for the runtime to report", async () => {
    const { fn } = fakeFetch(() => ({
      body: {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ id: "c1", type: "function", function: { name: "nola_answer", arguments: '{"other":1}' } }],
            },
          },
        ],
      },
    }));
    const res = await openai({ apiKey: "k", fetch: fn, model: "m" }).infer({ intent: intent() });
    expect(res.text).toBe('{"other":1}');
  });

  it("structuredOutputs: false — no answer tool, tool_choice auto, the schema in the system turn, a text reply is the answer", async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { choices: [{ message: { content: '{"value":["a"]}' } }] } }));
    const res = await openai({ apiKey: "k", fetch: fn, model: "m", structuredOutputs: false }).infer({ intent: intent() });
    expect(res.text).toBe('["a"]');
    const sent = body(calls);
    expect(sent.tools.map((t: { function: { name: string } }) => t.function.name)).toEqual(["fs_readFile"]);
    expect(sent.tool_choice).toBe("auto");
    expect(sent.response_format).toBeUndefined();
    expect(sent.messages[0].content).toContain("<schema>");
  });

  it("an ask without tools sends no tools field", async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { choices: [{ message: { content: '{"value":"x"}' } }] } }));
    await openai({ apiKey: "k", fetch: fn, model: "m" }).infer({
      intent: { intent: "extract", input: { instruction: "p" }, output: { syntax: "json", schema: { type: "string" } } },
    });
    expect(body(calls).tools).toBeUndefined();
  });
});

// `toolUse` names the model's tool-use strategy beside `structuredOutputs`:
// "native" (the default) is the vendor's tool-calling API with the loop in
// Nola; false says the host offers none — the model is unbranded, so a
// tool-use ask is refused before the network and a fallback group skips it.
// Other strategies join the union as they land; an unknown value is NOLA3003.
describe("openai — toolUse", () => {
  it("defaults to native tool use; a given strategy is recorded on the model", () => {
    expect(openai({ apiKey: "k", model: "m" }).toolUse).toBeUndefined();
    const p = openai({ apiKey: "k", model: "m", toolUse: "native" });
    expect(isToolModel(p)).toBe(true);
    expect(p.toolUse).toBe("native");
  });

  it("toolUse: false leaves the model unbranded", () => {
    const p = openai({ apiKey: "k", model: "m", toolUse: false });
    expect(isToolModel(p)).toBe(false);
    expect(p.toolUse).toBe(false);
  });

  it("an unknown toolUse value is NOLA3003 at construction, naming the accepted values", () => {
    let caught: unknown;
    try {
      openai({ apiKey: "k", model: "m", toolUse: "code" as never });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NolaConfigError);
    expect((caught as NolaConfigError).code).toBe(Codes.ConfigInvalid);
    expect((caught as Error).message).toMatch(/toolUse.*"native".*false/);
  });
});
