import { Codes } from "@nola-lang/ast";
import { mockProvider } from "@nola-lang/providers";
import { ask, ExtractIntent, Frame, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { openTestFrame } from "./helpers/frame.js";

afterEach(() => nolaRuntime.reset());

const ctx = () => openTestFrame();

describe("ExtractIntent", () => {
  it("resolves via ask and appends to shared history", async () => {
    nolaRuntime.configure({ providers: { default: mockProvider(["Evgen", 42]) } });
    const c = ctx();
    const name = await ask(
      new ExtractIntent<string>({ instruction: "user name", type: { type: "string" }, loc: "1:1" }),
      c,
    );
    const age = await ask(new ExtractIntent<number>({ instruction: "age", type: { type: "number" }, loc: "2:1" }), c);
    expect(name).toBe("Evgen");
    expect(age).toBe(42);
    expect(c.history).toEqual([
      { prompt: "user name", value: "Evgen" },
      { prompt: "age", value: 42 },
    ]);
  });

  it("derives `file` from the context lineage root when the init omits it", async () => {
    // Lowering (emit 3) no longer bakes `file` into every intent — under `ask`
    // the invocation context's root carries it.
    const seen: string[] = [];
    nolaRuntime.configure({
      providers: { default: mockProvider(["Evgen"]) },
      hooks: [{ onAskEnd: (e) => seen.push(e.receipt.site.file) }],
    });
    await ask(new ExtractIntent<string>({ instruction: "user name", type: { type: "string" }, loc: "1:1" }), ctx());
    expect(seen).toEqual(["x.tsi"]);
  });

  it("falls back to <unknown> when no context carries a file", async () => {
    const seen: string[] = [];
    nolaRuntime.configure({
      providers: { default: mockProvider(["free text"]) },
      hooks: [{ onAskEnd: (e) => seen.push(e.receipt.site.file) }],
    });
    // A scope with no FileInferContext anywhere in the lineage.
    const c = Frame.open(nolaRuntime.current().system.scope({ fn: "go", instruction: "" }));
    await ask(new ExtractIntent({ instruction: "anything" }), c);
    expect(seen).toEqual(["<unknown>"]);
  });

  it("bare thenable await is a definitive error — extract intents carry no scope, only `ask` supplies a frame", async () => {
    nolaRuntime.configure({ providers: { default: mockProvider(["free text"]) } });
    await expect(new ExtractIntent({ instruction: "anything" })).rejects.toMatchObject({
      name: "NolaIntentError",
      code: Codes.IntentWithoutContext,
    });
  });

  it("withProvider(name) routes the ask to the named provider", async () => {
    nolaRuntime.configure({
      providers: { default: mockProvider(["default-answer"]), fast: mockProvider(["fast-answer"]) },
    });
    const intent = new ExtractIntent<string>({ instruction: "m", type: { type: "string" }, loc: "1:1" });
    await expect(ask(intent.withProvider("fast"), ctx())).resolves.toBe("fast-answer");
  });

  it("withProvider(instance) uses the instance directly", async () => {
    nolaRuntime.configure({ providers: { default: mockProvider(["default-answer"]) } });
    const pinned = { name: "pinned", complete: async () => ({ text: '"pinned-answer"' }) };
    const intent = new ExtractIntent<string>({ instruction: "m", type: { type: "string" }, loc: "1:1" });
    await expect(ask(intent.withProvider(pinned), ctx())).resolves.toBe("pinned-answer");
  });

  it("withProvider with an unknown name rejects with ConfigUnknownProvider", async () => {
    nolaRuntime.configure({ providers: { default: mockProvider(["d"]) } });
    const intent = new ExtractIntent<string>({ instruction: "m", type: { type: "string" }, loc: "1:1" });
    await expect(ask(intent.withProvider("nope"), ctx())).rejects.toMatchObject({
      code: Codes.ConfigUnknownProvider,
    });
  });
});
