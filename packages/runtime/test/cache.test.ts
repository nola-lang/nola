import type { AskReceipt } from "@nola-lang/core";
import { mockProvider } from "@nola-lang/providers";
import type { Frame } from "@nola-lang/runtime";
import { __nola, memoryCacheStore, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { openTestFrame } from "./helpers/frame.js";
import { askViaInference } from "./helpers/inference.js";

afterEach(() => nolaRuntime.reset());

const ctx = () => openTestFrame();
const ask = (prompt = "user name") => askViaInference({ frame: ctx(), prompt, schema: { type: "string" }, loc: "1:1" });

function capture() {
  const receipts: AskReceipt[] = [];
  return { receipts, hook: { name: "cap", onAskEnd: (e: { receipt: AskReceipt }) => receipts.push(e.receipt) } };
}

// TODO(cache): the fingerprint cache is deliberately unwired for v1 — see the TODO(cache) in
// inference.ts terminal(). Un-skip when the store is served from the fingerprint again.
describe.skip("fingerprint cache", () => {
  it("second identical ask is served from cache: servedBy cache, attempts 0, zero wire calls", async () => {
    const { receipts, hook } = capture();
    let wireCalls = 0;
    nolaRuntime.configure({
      providers: {
        default: {
          name: "probe",
          complete: async () => {
            wireCalls++;
            return { text: '"Evgen"' };
          },
        },
      },
      cache: {},
      hooks: [hook],
    });
    await expect(ask()).resolves.toBe("Evgen");
    await expect(ask()).resolves.toBe("Evgen");
    expect(wireCalls).toBe(1);
    expect(receipts[1]).toMatchObject({ servedBy: "cache", attempts: 0, outcome: { ok: true, value: "Evgen" } });
    expect(receipts[1]?.fingerprint).toBe(receipts[0]?.fingerprint);
  });

  it("different prompts are different keys (both hit the wire)", async () => {
    let wireCalls = 0;
    nolaRuntime.configure({
      providers: {
        default: {
          name: "probe",
          complete: async () => {
            wireCalls++;
            return { text: '"v"' };
          },
        },
      },
      cache: {},
    });
    await ask("a");
    await ask("b");
    expect(wireCalls).toBe(2);
  });

  it("a poisoned store still fails schema validation (cache cannot bypass the type contract)", async () => {
    const inner = memoryCacheStore();
    // Wrapper that lies: always returns a schema-violating value once something is cached.
    const lyingStore = {
      get: async (k: string) => ((await inner.get(k)) === undefined ? undefined : 12345),
      set: (k: string, v: unknown) => inner.set(k, v),
    };
    nolaRuntime.configure({ providers: { default: mockProvider(["Evgen"]) }, cache: { store: lyingStore } });
    await expect(ask()).resolves.toBe("Evgen"); // run 1: miss, populates store
    await expect(ask()).rejects.toThrow(/served by cache does not match the requested schema/);
  });

  it("history chaining: ask #2's key changes when ask #1's answer changes", async () => {
    const { receipts, hook } = capture();
    const invoke = (answers: unknown[]) => {
      nolaRuntime.configure({ providers: { default: mockProvider(answers) }, hooks: [hook] });
      const fileCtx = nolaRuntime.current().fileContext("x.tsi");
      return __nola.intents.Intent(
        async (__ctx: Frame) => {
          await __nola.ask(
            __nola.intents.ExtractIntent({ instruction: "first", type: { type: "string" }, loc: "1:1" }),
            __ctx,
          );
          return await __nola.ask(
            __nola.intents.ExtractIntent({
              instruction: "second",
              type: { type: "string" },
              loc: "2:1",
            }),
            __ctx,
          );
        },
        fileCtx.func({ fn: "go", instruction: "" }),
      );
    };
    await invoke(["A", "x"]);
    nolaRuntime.reset();
    await invoke(["B", "x"]);
    // receipts: [first(A), second(after A), first(B), second(after B)]
    expect(receipts[1]?.fingerprint).not.toBe(receipts[3]?.fingerprint); // ask #2 key depends on ask #1's answer
    expect(receipts[0]?.fingerprint).toBe(receipts[2]?.fingerprint); // ask #1 key is identical across runs
  });
});
