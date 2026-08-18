import { type NolaHook, Site } from "@nola-lang/core";
import { mockProvider } from "@nola-lang/providers";
import { nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

const askStart = {
  askId: "a1",
  site: new Site("x.tsi", "1:1"),
  originalPrompt: "p",
  schema: { type: "string" } as const,
  provider: "mock",
};

afterEach(() => {
  nolaRuntime.reset();
  vi.restoreAllMocks();
});

describe("NolaRuntime.emitEvent", () => {
  it("is a no-op when nothing is configured", () => {
    expect(() => nolaRuntime.current().emitEvent("onAskStart", askStart)).not.toThrow();
  });

  it("dispatches to every configured hook, in config order", () => {
    const seen: string[] = [];
    const a: NolaHook = { name: "a", onAskStart: () => seen.push("a") };
    const b: NolaHook = { name: "b", onAskStart: () => seen.push("b") };
    nolaRuntime.configure({ providers: { default: mockProvider(["x"]) }, hooks: [a, b] });
    nolaRuntime.current().emitEvent("onAskStart", askStart);
    expect(seen).toEqual(["a", "b"]);
  });

  it("skips hooks that do not implement the method", () => {
    const hook: NolaHook = { name: "partial", onAskEnd: vi.fn() };
    nolaRuntime.configure({ providers: { default: mockProvider(["x"]) }, hooks: [hook] });
    expect(() => nolaRuntime.current().emitEvent("onAskStart", askStart)).not.toThrow();
    expect(hook.onAskEnd).not.toHaveBeenCalled();
  });

  it("swallows a throwing hook, warns once, and still runs later hooks", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const later = vi.fn();
    const boom: NolaHook = {
      name: "boom",
      onAskStart: () => {
        throw new Error("hook exploded with sk-proj-AbCd1234EfGh5678IjKl");
      },
    };
    nolaRuntime.configure({ providers: { default: mockProvider(["x"]) }, hooks: [boom, { onAskStart: later }] });

    nolaRuntime.current().emitEvent("onAskStart", askStart);
    nolaRuntime.current().emitEvent("onAskStart", askStart);

    expect(later).toHaveBeenCalledTimes(2); // a bad neighbour never blocks other hooks
    expect(warn).toHaveBeenCalledTimes(1); // warned once, not per event
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toMatch(/boom/);
    expect(message).toMatch(/onAskStart/);
    expect(message).not.toMatch(/AbCd1234/); // redacted
  });

  it("nolaRuntime.reset() clears the warn-once ledger (fresh instance, fresh ledger)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const boom: NolaHook = {
      name: "boom",
      onAskStart: () => {
        throw new Error("kaboom");
      },
    };
    nolaRuntime.configure({ providers: { default: mockProvider(["x"]) }, hooks: [boom] });
    nolaRuntime.current().emitEvent("onAskStart", askStart);
    expect(warn).toHaveBeenCalledTimes(1);

    nolaRuntime.reset();
    nolaRuntime.configure({ providers: { default: mockProvider(["x"]) }, hooks: [boom] });
    nolaRuntime.current().emitEvent("onAskStart", askStart);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
