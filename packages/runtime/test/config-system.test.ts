import { mockProvider } from "@nola-lang/providers";
import { resolveNolaConfig } from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";

const providers = { default: mockProvider(["x"]) };

describe("config system key", () => {
  it("accepts system: { message } and freezes it", () => {
    const resolved = resolveNolaConfig({ providers, system: { message: "Be terse." } });
    expect(resolved.system?.message).toBe("Be terse.");
    expect(Object.isFrozen(resolved.system)).toBe(true);
  });

  it("accepts an empty system object", () => {
    const resolved = resolveNolaConfig({ providers, system: {} });
    expect(resolved.system?.message).toBeUndefined();
  });

  it("omitted system stays undefined", () => {
    expect(resolveNolaConfig({ providers }).system).toBeUndefined();
  });

  it("rejects a non-object system", () => {
    expect(() => resolveNolaConfig({ providers, system: "hi" })).toThrow(/`system` must be an object/);
  });

  it("rejects a non-string system.message", () => {
    expect(() => resolveNolaConfig({ providers, system: { message: 42 } })).toThrow(/system\.message must be a string/);
  });
});
