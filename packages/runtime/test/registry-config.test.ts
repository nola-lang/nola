import { mockProvider } from "@nola-lang/providers";
import { nolaRuntime, terminalTrace } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => nolaRuntime.reset());

describe("NolaRuntime config", () => {
  it("is null before configuration", () => {
    expect(nolaRuntime.current().config).toBeNull();
  });

  it("holds the frozen resolved config after nolaRuntime.configure", () => {
    nolaRuntime.configure({ model: { default: mockProvider(["x"]) }, telemetry: [terminalTrace({ level: "debug" })] });
    const cfg = nolaRuntime.current().config;
    expect(cfg?.telemetry.map((o) => o.name)).toEqual(["nola:terminal"]);
    expect(Object.isFrozen(cfg)).toBe(true);
  });
});
