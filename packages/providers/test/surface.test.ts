import { isInferModel, isPlatformModel } from "@nola-lang/core";
import * as pkg from "@nola-lang/providers";
import { mockProvider, openai, providers, typesafe } from "@nola-lang/providers";
import { describe, expect, it } from "vitest";
import { modelOf, requestOf } from "./helpers/model.js";

// @nola-lang/providers is the home for everything bring-your-own: vendor
// factories, the namespace map, resilience combinators, record/replay
// (spec addendum 2026-08-10). The native managed provider is NOT here —
// nola() moved to @nola-lang/runtime (amendment 2026-08-30), a clean break
// with no re-export, so the one true import path never forks.
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

  it("exports typesafe as a bare name and in the namespace map; a bare string is its model", async () => {
    expect(typeof typesafe).toBe("function");
    expect(providers.typesafe).toBe(typesafe);
    expect(typesafe().name).toBe("typesafe");
    let body: { model: string } | undefined;
    const fn = (async (_url: unknown, init: unknown) => {
      body = JSON.parse(String((init as RequestInit).body)) as { model: string };
      return new Response(JSON.stringify({ answers: { value: { type: "noul", noul: 1 } } }));
    }) as typeof globalThis.fetch;
    // `typesafe("jev-3")` has no fetch slot; the same shorthand goes through the options form for the wire check.
    const p = providers.typesafe({ model: "jev-3", apiKey: "k", fetch: fn });
    if (!isInferModel(p)) throw new Error("typesafe is an infer-dialect model");
    await p.infer({ model: modelOf({ schema: { type: "boolean" } }) });
    expect(body?.model).toBe("jev-3");
    expect(typesafe("jev-3").name).toBe("typesafe");
  });

  it("mockProvider takes options; the frozen factory names are unchanged", () => {
    const m = mockProvider(["x"], { decisions: true });
    expect(m.name).toBe("mock");
  });

  it("does not export nola() — the native provider lives in @nola-lang/runtime, no alias here", () => {
    const surface = pkg as Record<string, unknown>;
    expect(surface.nola).toBeUndefined();
    expect(surface.NOLA_VERSION).toBeUndefined();
    expect((pkg.providers as Record<string, unknown>).nola).toBeUndefined();
  });

  it("exports the resilience combinators", () => {
    expect(typeof pkg.withRetry).toBe("function");
    expect(typeof pkg.fallback).toBe("function");
    expect(typeof pkg.roundRobin).toBe("function");
    expect(typeof pkg.constant).toBe("function");
    expect(typeof pkg.exponential).toBe("function");
  });

  it("mockProvider's callback receives the classic rendering — typed as ClassicPrompt, no narrowing needed in a config", async () => {
    let seen: string | undefined;
    const p = mockProvider((req) => {
      seen = req.payload.messages[0]?.content;
      return "v";
    });
    expect(isPlatformModel(p)).toBe(false);
    await p.complete(requestOf({ instruction: "from the runtime" }));
    expect(seen).toContain("from the runtime");
  });

  it("no longer exports classicPayload — complete() is typed on the classic request outright (reshape 2026-09-01)", () => {
    expect((pkg as Record<string, unknown>).classicPayload).toBeUndefined();
  });

  it("exports record/replay", () => {
    expect(typeof pkg.record).toBe("function");
    expect(typeof pkg.replay).toBe("function");
  });
});
