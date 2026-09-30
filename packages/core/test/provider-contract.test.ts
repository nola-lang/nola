import type { InferenceModel, InferRequest, InferResult, LanguageModel, PlatformModel, ProviderRequestEvent, ProviderResponseEvent } from "@nola-lang/core";
import * as core from "@nola-lang/core";
import { isPlatformModel, PLATFORM_MODEL, renderPrompt } from "@nola-lang/core";
import { describe, expect, it } from "vitest";

const intent: InferenceModel = { intent: "extract", input: { instruction: "p" }, output: { syntax: "json", schema: { type: "string" } } };

describe("the one provider interface (spec 2026-09-28 §3.4)", () => {
  it("a LanguageModel is { name, infer(req) } and infer receives the intent", async () => {
    let seen: InferRequest | undefined;
    const model: LanguageModel = {
      name: "m",
      async infer(req) {
        seen = req;
        return { text: '"x"', sent: renderPrompt(req.intent) };
      },
    };
    const res: InferResult = await model.infer({ intent, params: { temperature: 0 }, profile: "fast" });
    expect(seen?.intent).toBe(intent);
    expect(seen?.profile).toBe("fast");
    expect(res.sent?.messages[0]?.role).toBe("user");
  });

  it("the platform model is a LanguageModel carrying the brand", () => {
    const p: PlatformModel = {
      name: "nola",
      async infer() {
        return { text: "1" };
      },
      [PLATFORM_MODEL]: true,
    };
    const asModel: LanguageModel = p;
    expect(isPlatformModel(asModel)).toBe(true);
    expect(
      isPlatformModel({
        name: "x",
        async infer() {
          return { text: "1" };
        },
      }),
    ).toBe(false);
  });

  it("events carry the intent on the request and the echo on the response", () => {
    const req: ProviderRequestEvent = { askId: "a", attempt: 1, provider: "m", intent };
    const res: ProviderResponseEvent = { askId: "a", attempt: 1, provider: "m", text: "1", durationMs: 2, sent: renderPrompt(intent) };
    expect(req.intent.input.instruction).toBe("p");
    expect(res.sent?.system.length).toBeGreaterThan(0);
  });

  it("the chat dialect is gone from the surface", () => {
    for (const gone of ["isInferModel", "isInferenceModel", "renderClassic", "renderClassicText", "SYSTEM_PREAMBLE"]) {
      expect((core as Record<string, unknown>)[gone], gone).toBeUndefined();
    }
  });
});
