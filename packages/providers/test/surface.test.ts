import * as pkg from "@nola-lang/providers";
import { mockProvider, openai, providers } from "@nola-lang/providers";
import { describe, expect, it } from "vitest";

// @nola-lang/providers is the ONE home for everything provider-shaped
// (spec addendum 2026-08-10): factories, the namespace map, resilience
// combinators, record/replay. The config-file import surface is frozen on it.
describe("@nola-lang/providers surface", () => {
  it("exports each factory as a bare name", () => {
    expect(typeof openai).toBe("function");
    expect(typeof mockProvider).toBe("function");
  });

  it("exports the namespace map, keyed by provider name", () => {
    expect(providers.openai).toBe(openai);
    expect(providers.mock).toBe(mockProvider);
    expect(providers.mock(["x"]).name).toBe("mock");
  });

  it("exports the resilience combinators", () => {
    expect(typeof pkg.withRetry).toBe("function");
    expect(typeof pkg.fallback).toBe("function");
    expect(typeof pkg.roundRobin).toBe("function");
    expect(typeof pkg.constant).toBe("function");
    expect(typeof pkg.exponential).toBe("function");
  });

  it("exports record/replay", () => {
    expect(typeof pkg.record).toBe("function");
    expect(typeof pkg.replay).toBe("function");
  });
});
