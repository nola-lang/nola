import { mockProvider } from "@nola-lang/providers";
import { NolaConfigError, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { openTestFrame } from "./helpers/frame.js";
import { askViaInference } from "./helpers/inference.js";

afterEach(() => nolaRuntime.reset());

const frame = () => openTestFrame();

const ask = () => askViaInference({ frame: frame(), prompt: "p", schema: { type: "string" }, loc: "1:1" });

describe("config latch", () => {
  it("nolaRuntime.configure may be called repeatedly before the first ask (last wins)", () => {
    nolaRuntime.configure({ providers: { default: mockProvider(["a"]) } });
    nolaRuntime.configure({ providers: { default: { ...mockProvider(["b"]), name: "second" } } });
    expect(nolaRuntime.current().resolveProvider().name).toBe("second");
  });

  it("the first successful ask latches: nolaRuntime.configure then throws NolaConfigError", async () => {
    nolaRuntime.configure({ providers: { default: mockProvider(["x"]) } });
    await ask();
    expect(() => nolaRuntime.configure({ providers: { default: mockProvider(["y"]) } })).toThrow(NolaConfigError);
    expect(() => nolaRuntime.configure({ providers: { default: mockProvider(["y"]) } })).toThrow(/nolaRuntime\.reset/);
  });

  it("an unconfigured ask fails without latching — configure-and-retry works", async () => {
    await expect(ask()).rejects.toThrow(/No Nola provider configured/);
    nolaRuntime.configure({ providers: { default: mockProvider(["x"]) } });
    await expect(ask()).resolves.toBe("x");
  });

  it("a failed ask still latches a present config (the config was used)", async () => {
    nolaRuntime.configure({ providers: { default: mockProvider(["nope", "still nope"]) } });
    await expect(
      askViaInference({ frame: frame(), prompt: "p", schema: { type: "number" }, loc: "1:1" }),
    ).rejects.toThrow();
    expect(() => nolaRuntime.configure({ providers: { default: mockProvider([1]) } })).toThrow(NolaConfigError);
  });

  it("nolaRuntime.reset() clears the latch", async () => {
    nolaRuntime.configure({ providers: { default: mockProvider(["x"]) } });
    await ask();
    nolaRuntime.reset();
    expect(() => nolaRuntime.configure({ providers: { default: mockProvider(["y"]) } })).not.toThrow();
  });
});
