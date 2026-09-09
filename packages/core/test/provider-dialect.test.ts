import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";
import { isInferenceModel } from "../src/provider-dialect.js";

describe("payload discrimination", () => {
  it("isInferenceModel tells the model from its classic rendering", () => {
    expect(isInferenceModel({ intent: {}, input: {}, output: {} } as never)).toBe(true);
    expect(isInferenceModel({ messages: [{ role: "user", content: "p" }], output: { syntax: "text" } } as never)).toBe(
      false,
    );
  });
});

describe("legacy dialect surface is deleted (reshape 2026-09-01)", () => {
  it("core no longer exports isModelProvider or the ProviderCapabilities descriptor", () => {
    expect("isModelProvider" in core).toBe(false);
    // the dialect gate is the platform-model brand + infer (platform-model.ts, design 2026-09-03)
    expect(core.isPlatformModel({ name: "m", infer: async () => ({ text: "" }), [core.PLATFORM_MODEL]: true })).toBe(true);
    expect(core.isPlatformModel({ name: "unbranded", infer: async () => ({ text: "" }) })).toBe(false);
    expect(core.isPlatformModel({ name: "classic", complete: async () => ({ text: "" }) })).toBe(false);
  });
});
