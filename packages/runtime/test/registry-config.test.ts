import { mockProvider } from "@nola-lang/providers";
import { nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => nolaRuntime.reset());

describe("NolaRuntime config", () => {
  it("is null before configuration", () => {
    expect(nolaRuntime.current().config).toBeNull();
  });

  it("holds the frozen resolved config after nolaRuntime.configure", () => {
    nolaRuntime.configure({ providers: { default: mockProvider(["x"]) }, observability: { logLevel: "debug" } });
    const cfg = nolaRuntime.current().config;
    expect(cfg?.observability.logLevel).toBe("debug");
    expect(cfg?.hooks).toEqual([]);
    expect(Object.isFrozen(cfg)).toBe(true);
  });
});
