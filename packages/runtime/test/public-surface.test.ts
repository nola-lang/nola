import { mockProvider } from "@nola-lang/providers";
import type { Askable, Intent } from "@nola-lang/runtime";
import * as root from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";

// The runtime index is the app-facing surface: defineConfig lives here (flat,
// no subpaths — spec addendum 2026-08-10), alongside errors, redaction, and
// isIntent. Provider factories deliberately do NOT: they live in
// @nola-lang/providers, and re-exporting them here would fork the one true
// import path the config file teaches.
describe("@nola-lang/runtime public surface", () => {
  it("exports defineConfig from the index and it accepts a provider map", () => {
    expect(typeof root.defineConfig).toBe("function");
    const cfg = root.defineConfig({ providers: { default: mockProvider(["x"]) } });
    expect(cfg.providers.default.name).toBe("mock");
  });

  it("exports the app-side essentials", () => {
    expect(typeof root.nolaRuntime.configure).toBe("function");
    expect(typeof root.NolaConfigError).toBe("function");
    expect(typeof root.NolaResolutionError).toBe("function");
    expect(typeof root.isIntent).toBe("function");
    expect(typeof root.redactSecrets).toBe("function");
    expect(typeof root.effectiveLogLevel).toBe("function");
    // prompt templates: the tag lowered templates render through, and the renderer seam
    expect(typeof root.tpl).toBe("function");
    expect(typeof root.defaultPromptRenderer.extract).toBe("function");
    // the public Intent/Askable types are interfaces, not the class
    const check: Intent<string> | null = null;
    const askable: Askable<string> | null = check;
    expect(askable).toBeNull();
  });

  it("does not export provider factories — those live in @nola-lang/providers", () => {
    const surface = root as Record<string, unknown>;
    expect(surface.openai).toBeUndefined();
    expect(surface.mockProvider).toBeUndefined();
    expect(surface.providers).toBeUndefined();
    expect(surface.withRetry).toBeUndefined();
  });
});
