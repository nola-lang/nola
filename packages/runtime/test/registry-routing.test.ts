import { Codes } from "@nola-lang/ast";
import { mockProvider } from "@nola-lang/providers";
import { NolaConfigError, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";

const named = (name: string) => ({ ...mockProvider(["x"]), name });
const resolveProvider = (ref?: Parameters<ReturnType<typeof nolaRuntime.current>["resolveProvider"]>[0]) =>
  nolaRuntime.current().resolveProvider(ref);

afterEach(() => nolaRuntime.reset());

describe("NolaRuntime.resolveProvider", () => {
  it("throws the no-config error when nothing is configured", () => {
    expect(() => resolveProvider()).toThrow(/No Nola provider configured/);
  });

  it("returns the default provider when no ref is given", () => {
    nolaRuntime.configure({ providers: { default: named("d") } });
    expect(resolveProvider().name).toBe("d");
  });

  it("resolves a name ref against the providers map", () => {
    nolaRuntime.configure({ providers: { default: named("d"), fast: named("f") } });
    expect(resolveProvider("fast").name).toBe("f");
  });

  it("returns an instance ref as-is", () => {
    nolaRuntime.configure({ providers: { default: named("d") } });
    const pinned = named("pinned");
    expect(resolveProvider(pinned)).toBe(pinned);
  });

  it("throws ConfigUnknownProvider for unknown names, listing configured ones", () => {
    nolaRuntime.configure({ providers: { default: named("d"), fast: named("f") } });
    let caught: unknown;
    try {
      resolveProvider("slow");
    } catch (e) {
      caught = e;
    }
    const err = caught as NolaConfigError;
    expect(err).toBeInstanceOf(NolaConfigError);
    expect(err.code).toBe(Codes.ConfigUnknownProvider);
    expect(err.message).toMatch(/default, fast/);
  });

  it("forceProvider wins over every ref (hermetic)", () => {
    nolaRuntime.configure({ providers: { default: named("d"), mock: named("m") }, forceProvider: "mock" });
    expect(resolveProvider().name).toBe("m");
    expect(resolveProvider("default").name).toBe("m");
    expect(resolveProvider(named("pinned")).name).toBe("m");
  });

  it("nolaRuntime.configure validates (bad config throws NolaConfigError, instance unchanged)", () => {
    expect(() => nolaRuntime.configure({ providers: {} } as never)).toThrow(NolaConfigError);
    expect(() => resolveProvider()).toThrow(/No Nola provider configured/);
  });
});
