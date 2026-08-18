import { mockProvider } from "@nola-lang/providers";
import { ask, ExtractIntent, FunctionCallingIntent, NolaResolutionError, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Intent } from "../src/intents/intent.js";
import { openTestFrame } from "./helpers/frame.js";

afterEach(() => nolaRuntime.reset());

const ctx = () => openTestFrame();
const slot = (instruction: string) => new ExtractIntent<string>({ instruction, type: { type: "string" } });

describe("FunctionCallingIntent", () => {
  it("fills slots with ONE combined LLM call and invokes the function", async () => {
    const complete = vi.fn(async () => ({ text: '{"arg0":"Evgen","arg2_n":"two"}' }));
    nolaRuntime.configure({ providers: { default: { name: "probe", complete } } });
    const fetchUser = vi.fn((a: string, b: number, o: { n: string }) => `${a}/${b}/${o.n}`);
    const result = await ask(
      new FunctionCallingIntent<string>({
        fn: fetchUser,
        name: "fetchUser",
        loc: "1:1",
        args: [slot("user name"), 42, { n: slot("word for 2") }],
      }),
      ctx(),
    );
    expect(complete).toHaveBeenCalledTimes(1);
    const schema = (complete.mock.calls[0]?.[0] as { output?: { schema?: unknown } })?.output?.schema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(schema.properties)).toEqual(["arg0", "arg2_n"]);
    expect(fetchUser).toHaveBeenCalledWith("Evgen", 42, { n: "two" });
    expect(result).toBe("Evgen/42/two");
  });

  it("awaits a promise-returning callee", async () => {
    nolaRuntime.configure({ providers: { default: mockProvider([{ arg0: "hi" }]) } });
    const fn = async (s: string) => s.toUpperCase();
    const result = await ask(new FunctionCallingIntent<string>({ fn, name: "fn", args: [slot("greeting")] }), ctx());
    expect(result).toBe("HI");
  });

  it("skips the LLM entirely when there are no slots", async () => {
    const complete = vi.fn(async () => ({ text: "{}" }));
    nolaRuntime.configure({ providers: { default: { name: "probe", complete } } });
    const result = await ask(
      new FunctionCallingIntent<number>({ fn: (a: number) => a + 1, name: "inc", args: [41] }),
      ctx(),
    );
    expect(result).toBe(42);
    expect(complete).not.toHaveBeenCalled();
  });

  it("appends the call to history", async () => {
    nolaRuntime.configure({ providers: { default: mockProvider([]) } });
    const c = ctx();
    await ask(new FunctionCallingIntent({ fn: () => "done", name: "f", args: [] }), c);
    expect(c.history).toEqual([{ prompt: "called f", value: "done" }]);
  });

  it("throws NolaResolutionError when the callee is not a function", async () => {
    nolaRuntime.configure({ providers: { default: mockProvider([]) } });
    await expect(ask(new FunctionCallingIntent({ fn: 42, name: "notFn", args: [] }), ctx())).rejects.toBeInstanceOf(
      NolaResolutionError,
    );
  });

  it("rejects a non-ExtractIntent intent slot", async () => {
    nolaRuntime.configure({ providers: { default: mockProvider([]) } });
    class AlienIntent extends Intent<number> {
      protected clone(): Intent<number> {
        return this;
      }
    }
    const alien = new AlienIntent(async () => 1, nolaRuntime.current().fileContext("x.tsi"));
    await expect(
      ask(new FunctionCallingIntent({ fn: (x: number) => x, name: "f", args: [alien] }), ctx()),
    ).rejects.toBeInstanceOf(NolaResolutionError);
  });

  it("withProvider routes the slot-filling ask to the named provider", async () => {
    nolaRuntime.configure({
      providers: {
        default: mockProvider([{ arg0: "from-default" }]),
        fast: mockProvider([{ arg0: "from-fast" }]),
      },
    });
    const target = (v: string) => v;
    const intent = new FunctionCallingIntent<string>({
      fn: target,
      name: "target",
      args: [slot("value")],
      loc: "1:1",
    });
    await expect(ask(intent.withProvider("fast"), ctx())).resolves.toBe("from-fast");
  });
});
