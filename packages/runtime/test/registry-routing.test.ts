import { Codes } from "@nola-lang/ast";
import { mockProvider } from "@nola-lang/providers";
import { NolaConfigError, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";

const named = (name: string) => ({ ...mockProvider(["x"]), name });
const resolveModel = (ref?: Parameters<ReturnType<typeof nolaRuntime.current>["resolveModel"]>[0]) =>
  nolaRuntime.current().resolveModel(ref);

afterEach(() => nolaRuntime.reset());

describe("NolaRuntime.resolveModel", () => {
  it("throws the no-config error when nothing is configured", () => {
    expect(() => resolveModel()).toThrow(/No Nola model configured/);
  });

  it("returns the default provider when no ref is given", () => {
    nolaRuntime.configure({ model: { default: named("d") } });
    expect(resolveModel().name).toBe("d");
  });

  it("resolves a name ref against the providers map", () => {
    nolaRuntime.configure({ model: { default: named("d"), fast: named("f") } });
    expect(resolveModel("fast").name).toBe("f");
  });

  it("returns an instance ref as-is", () => {
    nolaRuntime.configure({ model: { default: named("d") } });
    const pinned = named("pinned");
    expect(resolveModel(pinned)).toBe(pinned);
  });

  it("throws ConfigUnknownModel for unknown names, listing configured ones", () => {
    nolaRuntime.configure({ model: { default: named("d"), fast: named("f") } });
    let caught: unknown;
    try {
      resolveModel("slow");
    } catch (e) {
      caught = e;
    }
    const err = caught as NolaConfigError;
    expect(err).toBeInstanceOf(NolaConfigError);
    expect(err.code).toBe(Codes.ConfigUnknownModel);
    expect(err.message).toMatch(/default, fast/);
  });

  it("forceModel wins over every ref (hermetic)", () => {
    nolaRuntime.configure({ model: { default: named("d"), mock: named("m") }, forceModel: "mock" });
    expect(resolveModel().name).toBe("m");
    expect(resolveModel("default").name).toBe("m");
    expect(resolveModel(named("pinned")).name).toBe("m");
  });

  it("nolaRuntime.configure validates (bad config throws NolaConfigError, instance unchanged)", () => {
    expect(() => nolaRuntime.configure({ model: {} } as never)).toThrow(NolaConfigError);
    expect(() => resolveModel()).toThrow(/No Nola model configured/);
  });
});
