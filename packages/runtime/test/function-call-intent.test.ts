import type { AskReceipt, AskStartEvent, ProviderRequest } from "@nola-lang/core";
import { mockProvider } from "@nola-lang/providers";
import { ask, ExtractIntent, FunctionCallIntent, NolaResolutionError, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Intent } from "../src/intents/intent.js";
import { openTestFrame } from "./helpers/frame.js";

afterEach(() => nolaRuntime.reset());

const ctx = () => openTestFrame();
const slot = (instruction: string) => new ExtractIntent<string>({ instruction, type: { type: "string" } });

describe("FunctionCallIntent", () => {
  it("fills slots with ONE combined LLM call and invokes the function", async () => {
    const complete = vi.fn(async () => ({ text: '{"arg0":"Evgen","arg2_n":"two"}' }));
    nolaRuntime.configure({ model: { default: { name: "probe", complete } } });
    const fetchUser = vi.fn((a: string, b: number, o: { n: string }) => `${a}/${b}/${o.n}`);
    const result = await ask(
      new FunctionCallIntent<string>({
        fn: fetchUser,
        name: "fetchUser",
        loc: "1:1",
        args: [slot("user name"), 42, { n: slot("word for 2") }],
      }),
      ctx(),
    );
    expect(complete).toHaveBeenCalledTimes(1);
    const schema = (complete.mock.calls[0]?.[0] as { payload?: { output?: { schema?: unknown } } })?.payload?.output
      ?.schema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(schema.properties)).toEqual(["arg0", "arg2_n"]);
    expect(fetchUser).toHaveBeenCalledWith("Evgen", 42, { n: "two" });
    expect(result).toBe("Evgen/42/two");
  });

  it("awaits a promise-returning callee", async () => {
    nolaRuntime.configure({ model: { default: mockProvider([{ arg0: "hi" }]) } });
    const fn = async (s: string) => s.toUpperCase();
    const result = await ask(new FunctionCallIntent<string>({ fn, name: "fn", args: [slot("greeting")] }), ctx());
    expect(result).toBe("HI");
  });

  it("skips the LLM entirely when there are no slots", async () => {
    const complete = vi.fn(async () => ({ text: "{}" }));
    nolaRuntime.configure({ model: { default: { name: "probe", complete } } });
    const result = await ask(
      new FunctionCallIntent<number>({ fn: (a: number) => a + 1, name: "inc", args: [41] }),
      ctx(),
    );
    expect(result).toBe(42);
    expect(complete).not.toHaveBeenCalled();
  });

  it("appends the call to history", async () => {
    nolaRuntime.configure({ model: { default: mockProvider([]) } });
    const c = ctx();
    await ask(new FunctionCallIntent({ fn: () => "done", name: "f", args: [] }), c);
    expect(c.history).toEqual([{ prompt: "called f", value: "done" }]);
  });

  it("throws NolaResolutionError when the callee is not a function", async () => {
    nolaRuntime.configure({ model: { default: mockProvider([]) } });
    await expect(ask(new FunctionCallIntent({ fn: 42, name: "notFn", args: [] }), ctx())).rejects.toBeInstanceOf(
      NolaResolutionError,
    );
  });

  it("rejects a non-ExtractIntent intent slot", async () => {
    nolaRuntime.configure({ model: { default: mockProvider([]) } });
    class AlienIntent extends Intent<number> {
      protected clone(): Intent<number> {
        return this;
      }
    }
    const alien = new AlienIntent(async () => 1, nolaRuntime.current().fileContext("x.tsi"));
    await expect(
      ask(new FunctionCallIntent({ fn: (x: number) => x, name: "f", args: [alien] }), ctx()),
    ).rejects.toBeInstanceOf(NolaResolutionError);
  });

  it("withModel routes the slot-filling ask to the named provider", async () => {
    nolaRuntime.configure({
      model: {
        default: mockProvider([{ arg0: "from-default" }]),
        fast: mockProvider([{ arg0: "from-fast" }]),
      },
    });
    const target = (v: string) => v;
    const intent = new FunctionCallIntent<string>({
      fn: target,
      name: "target",
      args: [slot("value")],
      loc: "1:1",
    });
    await expect(ask(intent.withModel("fast"), ctx())).resolves.toBe("from-fast");
  });
});

describe("FunctionCallIntent — ask identity", () => {
  it("askStart and the receipt carry kind: call, callee and hint; the classic prompt is unchanged", async () => {
    const starts: AskStartEvent[] = [];
    const receipts: AskReceipt[] = [];
    const payloads: unknown[] = [];
    const complete = vi.fn(async (req: ProviderRequest) => {
      payloads.push(req.payload);
      return { text: '{"arg0":"Evgen"}' };
    });
    nolaRuntime.configure({
      model: { default: { name: "probe", complete } },
      telemetry: [{ name: "cap", onAskStart: (e) => starts.push(e), onAskEnd: (e) => receipts.push(e.receipt) }],
    });
    const fetchUser = (a: string) => a;
    await ask(
      new FunctionCallIntent<string>({
        fn: fetchUser,
        name: "fetchUser",
        instruction: "pick the user",
        loc: "1:1",
        args: [slot("user name")],
      }),
      ctx(),
    );
    expect(starts[0]).toMatchObject({
      kind: "call",
      callee: "fetchUser",
      hint: "pick the user",
      instruction: 'Generate the arguments for calling the function "fetchUser". pick the user',
    });
    expect(starts[0]?.typeText).toBeUndefined();
    expect(receipts[0]?.kind).toBe("call");
    // The provider is classic-dialect: it receives the rendering, whose TASK block is the synthesized request verbatim.
    const text = (payloads[0] as { messages: Array<{ content: string }> }).messages[0]?.content ?? "";
    expect(text).toContain(
      '<request>\nGenerate the arguments for calling the function "fetchUser". pick the user\n</request>',
    );
  });

  it('a call without a hint reports hint: ""', async () => {
    const starts: AskStartEvent[] = [];
    nolaRuntime.configure({
      model: { default: mockProvider([{ arg0: "x" }]) },
      telemetry: [{ name: "cap", onAskStart: (e) => starts.push(e) }],
    });
    await ask(new FunctionCallIntent({ fn: (s: string) => s, name: "f", args: [slot("s")] }), ctx());
    expect(starts[0]).toMatchObject({ kind: "call", callee: "f", hint: "" });
  });
});
