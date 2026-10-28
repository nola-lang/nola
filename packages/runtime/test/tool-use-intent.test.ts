import { Codes } from "@nola-lang/ast";
import type { InferenceModel, LanguageModel } from "@nola-lang/core";
import { mockProvider, toolCalls } from "@nola-lang/providers";
import {
  type AskEndEvent,
  type AskStartEvent,
  ask,
  nolaRuntime,
  ToolUseIntent,
  type ToolUseIntentInit,
  inferTypes as t,
  toolSource,
  toolSpreadSource,
  toolVerdicts,
} from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { openTestFrame } from "./helpers/frame.js";

afterEach(() => nolaRuntime.reset());

const searchArgs = t.object({ dir: t.string(), pattern: t.optional(t.string()) }).describe("Search files under a directory.");
const readArgs = t.object({ path: t.string() });

type ToolSet = ToolUseIntentInit["tools"];
const intent = (tools: ToolSet) =>
  new ToolUseIntent<string[]>({ instruction: "find the visa files", tools, type: t.array(t.string()), loc: "3:19", def: "d1" });

/** Every observer method, in the order it fired, plus what askStart/askEnd carried. */
function recorder() {
  const events: string[] = [];
  const started: AskStartEvent[] = [];
  const ended: AskEndEvent[] = [];
  const toolEnds: unknown[] = [];
  const hook = {
    onAskStart: (e: AskStartEvent) => {
      events.push("onAskStart");
      started.push(e);
    },
    onProviderRequest: () => events.push("onProviderRequest"),
    onProviderResponse: () => events.push("onProviderResponse"),
    onToolCallStart: () => events.push("onToolCallStart"),
    onToolCallEnd: (e: unknown) => {
      events.push("onToolCallEnd");
      toolEnds.push(e);
    },
    onValidationFailed: () => events.push("onValidationFailed"),
    onRetry: () => events.push("onRetry"),
    onAskEnd: (e: AskEndEvent) => {
      events.push("onAskEnd");
      ended.push(e);
    },
  };
  return { hook, events, started, ended, toolEnds };
}

describe("ToolUseIntent — the bounded loop (spec 2026-10-08 §3.5)", () => {
  it("answers on the first turn like an extractor when the model calls no tool", async () => {
    const rec = recorder();
    let invoked = 0;
    const search = async () => {
      invoked++;
      return [];
    };
    nolaRuntime.configure({ model: { default: mockProvider([["a.pdf"]], { tools: true }) }, telemetry: [rec.hook] });
    const value = await ask(intent([{ name: "search", call: search, args: searchArgs }]), openTestFrame());
    expect(value).toEqual(["a.pdf"]);
    expect(invoked).toBe(0);
    expect(rec.events).toEqual(["onAskStart", "onProviderRequest", "onProviderResponse", "onAskEnd"]);
    expect(rec.started[0]).toMatchObject({ kind: "tool-use", tools: ["search"], def: "d1", instruction: "find the visa files" });
    const receipt = rec.ended[0]?.receipt;
    expect(receipt?.kind).toBe("tool-use");
    expect(receipt?.attempts).toBe(1);
    expect(receipt?.turns).toBeUndefined();
  });

  it("runs the requested tool between turns and hands its result back in the transcript", async () => {
    const rec = recorder();
    const seen: unknown[][] = [];
    const search = async (dir: string, pattern?: string) => {
      seen.push([dir, pattern]);
      return ["D:/visa/a.pdf"];
    };
    const requests: InferenceModel[] = [];
    nolaRuntime.configure({
      model: {
        default: mockProvider(
          (req) => {
            requests.push(req.intent);
            return req.intent.transcript ? ["D:/visa/a.pdf"] : toolCalls([{ name: "search", args: { dir: "D:/" } }]);
          },
          { tools: true },
        ),
      },
      telemetry: [rec.hook],
    });
    const frame = openTestFrame();
    const value = await ask(intent([{ name: "search", call: search, args: searchArgs }]), frame);
    expect(value).toEqual(["D:/visa/a.pdf"]);
    expect(seen).toEqual([["D:/", undefined]]);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.intent).toBe("tool-use");
    expect(requests[0]?.tools).toEqual([
      { name: "search", description: "Search files under a directory.", parameters: searchArgs.toJsonSchema() },
    ]);
    expect(requests[0]?.transcript).toBeUndefined();
    expect(requests[1]?.transcript).toEqual([
      { calls: [{ id: expect.any(String), name: "search", args: { dir: "D:/" }, result: '["D:/visa/a.pdf"]' }] },
    ]);
    expect(rec.events).toEqual([
      "onAskStart",
      "onProviderRequest",
      "onProviderResponse",
      "onToolCallStart",
      "onToolCallEnd",
      "onProviderRequest",
      "onProviderResponse",
      "onAskEnd",
    ]);
    const receipt = rec.ended[0]?.receipt;
    expect(receipt?.attempts).toBe(2);
    expect(receipt?.turns).toEqual([
      {
        fingerprint: receipt?.fingerprint,
        calls: [{ name: "search", args: { dir: "D:/" }, result: '["D:/visa/a.pdf"]', durationMs: expect.any(Number) }],
      },
    ]);
    expect(receipt?.originalPrompt).not.toContain("<tool_result");
    expect(receipt?.effectivePrompt).toContain('<tool_result id=');
    expect(frame.history).toEqual([{ prompt: "find the visa files", value: ["D:/visa/a.pdf"] }]);
  });

  it("several calls in one turn run in the reply's order; a bound member chain keeps its receiver; results come back by the wire name", async () => {
    const order: string[] = [];
    const api = {
      base: "D:/",
      async search(dir: string) {
        order.push(`search:${this.base}${dir}`);
        return ["x"];
      },
    };
    const read = async (path: string) => {
      order.push(`read:${path}`);
      return "contents";
    };
    const requests: InferenceModel[] = [];
    nolaRuntime.configure({
      model: {
        default: mockProvider(
          (req) => {
            requests.push(req.intent);
            return req.intent.transcript
              ? ["done"]
              : toolCalls([
                  { name: "api_search", args: { dir: "visa" } },
                  { name: "read", args: { path: "p" } },
                ]);
          },
          { tools: true },
        ),
      },
    });
    const tools: ToolSet = [
      { name: "api.search", call: api.search.bind(api), args: t.object({ dir: t.string() }) },
      { name: "read", call: read, args: readArgs },
    ];
    await expect(ask(intent(tools), openTestFrame())).resolves.toEqual(["done"]);
    expect(order).toEqual(["search:D:/visa", "read:p"]);
    expect(requests[0]?.tools?.map((tool) => tool.name)).toEqual(["api.search", "read"]);
    expect(requests[1]?.transcript?.[0]?.calls.map((c) => [c.name, c.result])).toEqual([
      ["api_search", '["x"]'],
      ["read", "contents"],
    ]);
  });

  it("invalid arguments never reach the function: the issues come back as that call's result", async () => {
    let invoked = 0;
    const search = async () => {
      invoked++;
      return [];
    };
    const requests: InferenceModel[] = [];
    nolaRuntime.configure({
      model: {
        default: mockProvider(
          (req) => {
            requests.push(req.intent);
            return req.intent.transcript ? [] : toolCalls([{ name: "search", args: { dir: 5 } }]);
          },
          { tools: true },
        ),
      },
    });
    await expect(ask(intent([{ name: "search", call: search, args: searchArgs }]), openTestFrame())).resolves.toEqual([]);
    expect(invoked).toBe(0);
    const result = requests[1]?.transcript?.[0]?.calls[0]?.result ?? "";
    expect(result).toContain("invalid arguments");
    expect(result).toContain("dir");
  });

  it("an unknown tool name comes back as an error result that names the tools", async () => {
    const requests: InferenceModel[] = [];
    nolaRuntime.configure({
      model: {
        default: mockProvider(
          (req) => {
            requests.push(req.intent);
            return req.intent.transcript ? [] : toolCalls([{ name: "nope", args: {} }]);
          },
          { tools: true },
        ),
      },
    });
    await ask(intent([{ name: "search", call: async () => [], args: searchArgs }]), openTestFrame());
    const result = requests[1]?.transcript?.[0]?.calls[0]?.result ?? "";
    expect(result).toContain('unknown tool "nope"');
    expect(result).toContain("search");
  });

  it("a tool that throws fails the ask with NOLA3021, the cause and the transcript; toolCallEnd carries the error", async () => {
    const rec = recorder();
    const boom = new Error("disk on fire");
    nolaRuntime.configure({
      model: { default: mockProvider([toolCalls([{ name: "search", args: { dir: "D:/" } }]), []], { tools: true }) },
      telemetry: [rec.hook],
    });
    const search = async () => {
      throw boom;
    };
    await expect(ask(intent([{ name: "search", call: search, args: searchArgs }]), openTestFrame())).rejects.toMatchObject({
      name: "NolaIntentError",
      code: Codes.ToolCallFailed,
      message: expect.stringContaining("disk on fire"),
      cause: boom,
    });
    expect(rec.events).toEqual(["onAskStart", "onProviderRequest", "onProviderResponse", "onToolCallStart", "onToolCallEnd", "onAskEnd"]);
    expect(rec.toolEnds[0]).toMatchObject({ name: "search", turn: 1, error: expect.stringContaining("disk on fire") });
    expect(rec.ended[0]?.receipt.outcome.ok).toBe(false);
    expect(rec.ended[0]?.receipt.turns?.[0]?.calls[0]).toMatchObject({ name: "search", error: expect.stringContaining("disk on fire") });
  });

  describe("the turn cap", () => {
    const forever = () => mockProvider(() => toolCalls([{ name: "search", args: { dir: "D:/" } }]), { tools: true });

    it(".withMaxTurns(n) allows n provider turns, then NOLA3020 with the transcript", async () => {
      let invoked = 0;
      let calls = 0;
      const model = forever();
      // the brand rides the spread (an own enumerable symbol key); only `infer` is wrapped
      const counting: LanguageModel = {
        ...model,
        name: "counting",
        infer: (req) => {
          calls++;
          return model.infer(req);
        },
      };
      nolaRuntime.configure({ model: { default: counting } });
      const search = async () => {
        invoked++;
        return [];
      };
      await expect(
        ask(intent([{ name: "search", call: search, args: searchArgs }]).withMaxTurns(2), openTestFrame()),
      ).rejects.toMatchObject({ name: "NolaIntentError", code: Codes.ToolUseTurnsExceeded, message: expect.stringContaining("2") });
      expect(calls).toBe(2);
      expect(invoked).toBe(2);
    });

    it("config ask.maxTurns is the default", async () => {
      let invoked = 0;
      nolaRuntime.configure({ model: { default: forever() }, ask: { maxTurns: 1 } });
      await expect(
        ask(
          intent([
            {
              name: "search",
              call: async () => {
                invoked++;
                return [];
              },
              args: searchArgs,
            },
          ]),
          openTestFrame(),
        ),
      ).rejects.toMatchObject({ code: Codes.ToolUseTurnsExceeded });
      expect(invoked).toBe(1);
    });

    it("the correction turn after a bad answer is not counted against the cap", async () => {
      nolaRuntime.configure({
        model: { default: mockProvider([toolCalls([{ name: "search", args: { dir: "D:/" } }]), 42, ["ok"]], { tools: true }) },
      });
      const rec = recorder();
      nolaRuntime.configure({
        model: { default: mockProvider([toolCalls([{ name: "search", args: { dir: "D:/" } }]), 42, ["ok"]], { tools: true }) },
        telemetry: [rec.hook],
      });
      await expect(
        ask(intent([{ name: "search", call: async () => [], args: searchArgs }]).withMaxTurns(2), openTestFrame()),
      ).resolves.toEqual(["ok"]);
      expect(rec.ended[0]?.receipt.attempts).toBe(3);
      expect(rec.events.filter((e) => e === "onRetry")).toHaveLength(1);
    });

    it("withMaxTurns rejects a count that is not a positive integer", () => {
      const i = intent([]);
      expect(() => i.withMaxTurns(0)).toThrow(RangeError);
      expect(() => i.withMaxTurns(1.5)).toThrow(RangeError);
      expect(() => i.withMaxTurns(-1)).toThrow(RangeError);
    });
  });

  it("NOLA3019: a tool-use ask needs a model that can request tool calls — refused before the network, askEnd still fires", async () => {
    const rec = recorder();
    let calls = 0;
    const chat: LanguageModel = {
      name: "chatty",
      infer: async () => {
        calls++;
        return { text: "[]" };
      },
    };
    nolaRuntime.configure({ model: { default: chat }, telemetry: [rec.hook] });
    await expect(ask(intent([{ name: "search", call: async () => [], args: searchArgs }]), openTestFrame())).rejects.toMatchObject({
      name: "NolaIntentError",
      code: Codes.ToolModelRequired,
      message: expect.stringContaining('"chatty"'),
    });
    expect(calls).toBe(0);
    expect(rec.events).toEqual(["onAskStart", "onAskEnd"]);
    expect(rec.ended[0]?.receipt.outcome.ok).toBe(false);
  });

  it(".withRetry re-runs the whole loop, tools included", async () => {
    let invoked = 0;
    const search = async () => {
      invoked++;
      if (invoked === 1) throw new Error("flaky");
      return ["a"];
    };
    nolaRuntime.configure({
      model: {
        default: mockProvider((req) => (req.intent.transcript ? ["a"] : toolCalls([{ name: "search", args: { dir: "D:/" } }])), {
          tools: true,
        }),
      },
    });
    await expect(ask(intent([{ name: "search", call: search, args: searchArgs }]).withRetry(1), openTestFrame())).resolves.toEqual(["a"]);
    expect(invoked).toBe(2);
  });

  it("is Askable only: a bare await is NOLA3010, like an extractor", async () => {
    nolaRuntime.configure({ model: { default: mockProvider([[]], { tools: true }) } });
    await expect(intent([])).rejects.toMatchObject({ name: "NolaIntentError", code: Codes.IntentWithoutContext });
  });
});

describe("ToolUseIntent — lowered sources (spec 2026-10-09 §3.5)", () => {
  const fileTools = { search: async (dir: string) => [dir], readFile: async (path: string) => path };
  const members = toolVerdicts.members({ search: searchArgs, readFile: readArgs });

  it("a bare group is offered as `group.member`, a spread flat; askStart carries the names", async () => {
    const rec = recorder();
    nolaRuntime.configure({ model: { default: mockProvider([["a.pdf"]], { tools: true }) }, telemetry: [rec.hook] });
    const value = await ask(
      intent([
        toolSource(fileTools, members, "fileTools"),
        toolSpreadSource({ query: async (q: string) => q }, toolVerdicts.members({ query: readArgs })),
      ]),
      openTestFrame(),
    );
    expect(value).toEqual(["a.pdf"]);
    expect(rec.started[0]?.tools).toEqual(["fileTools.search", "fileTools.readFile", "query"]);
  });

  it("an invalid list is NOLA3022 on the ask span, before any provider call and before the brand check", async () => {
    const rec = recorder();
    nolaRuntime.configure({ model: { default: mockProvider([["a.pdf"]]) }, telemetry: [rec.hook] });
    await expect(ask(intent([toolSource(1, searchArgs, "one")]), openTestFrame())).rejects.toMatchObject({
      name: "NolaIntentError",
      code: Codes.ToolListInvalid,
    });
    expect(rec.events).toEqual(["onAskStart", "onAskEnd"]);
    expect(rec.started[0]?.tools).toEqual([]);
    expect(rec.ended[0]?.receipt.outcome).toEqual({ ok: false, error: expect.stringMatching(/'one' is not a function/) });
  });
});
