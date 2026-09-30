import type { InferRequest, LanguageModel, RenderedPrompt } from "@nola-lang/core";
import { DECISION_MODEL, renderPrompt } from "@nola-lang/core";

/** What a mock callback sees: the intent, plus its default rendering on demand. */
export type MockRequest = InferRequest & { readonly prompt: RenderedPrompt };

export interface MockOptions {
  /**
   * Brand the mock a decision model (decision types spec 2026-09-18 §6.1): a
   * test routing a Choice / Scale / Prob ask through a mock says so
   * explicitly — without it the runtime refuses, as it would for any
   * unbranded model.
   */
  decisions?: boolean;
}

/** The request with a memoized `prompt` getter — rendered only when a callback reads it. */
function withPrompt(req: InferRequest): MockRequest {
  let rendered: RenderedPrompt | undefined;
  return Object.defineProperty({ ...req }, "prompt", {
    enumerable: false,
    get: () => (rendered ??= renderPrompt(req.intent)),
  }) as MockRequest;
}

export function mockProvider(
  source: unknown[] | ((req: MockRequest) => unknown),
  options: MockOptions = {},
): LanguageModel {
  const queue = Array.isArray(source) ? [...source] : null;
  return {
    ...(options.decisions ? { [DECISION_MODEL]: true } : {}),
    name: "mock",
    async infer(req) {
      let value: unknown;
      if (queue) {
        if (queue.length === 0) throw new Error("mockProvider queue exhausted");
        value = queue.shift();
      } else {
        value = (source as (req: MockRequest) => unknown)(withPrompt(req));
      }
      return { text: JSON.stringify(value) };
    },
  };
}
