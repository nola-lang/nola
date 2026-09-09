import { isPlatformModel, PLATFORM_MODEL } from "@nola-lang/core";
import { describe, expect, it } from "vitest";

describe("platform model detection", () => {
  it("isPlatformModel reads the brand + infer(), nothing else", () => {
    const model = { name: "nola", infer: async () => ({ text: "" }), [PLATFORM_MODEL]: true as const };
    expect(isPlatformModel(model)).toBe(true);
    expect(isPlatformModel({ name: "nola", infer: async () => ({ text: "" }) })).toBe(false); // no brand
    expect(isPlatformModel({ name: "nola", [PLATFORM_MODEL]: true })).toBe(false); // no infer
    expect(isPlatformModel({ name: "mock", complete: async () => ({ text: "" }) })).toBe(false);
    expect(isPlatformModel(null)).toBe(false);
  });

  it("the managed-connection tier is gone from the public surface", async () => {
    const core = (await import("@nola-lang/core")) as Record<string, unknown>;
    expect(core.isManaged).toBeUndefined();
    expect(core.isManagedProvider).toBeUndefined();
  });
});
