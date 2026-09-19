import type { LanguageModel, ProviderRequest } from "@nola-lang/core";
import { DECISION_MODEL } from "@nola-lang/core";

/** What a mock callback sees: the classic request — `payload` IS the rendering (reshape 2026-09-01). */
export type MockRequest = ProviderRequest;

export interface MockOptions {
  /**
   * Brand the mock a decision model (decision types spec 2026-09-18 §6.1): a
   * test routing a Choice / Scale / Prob ask through a mock says so
   * explicitly — without it the runtime refuses, as it would for any
   * unbranded model.
   */
  decisions?: boolean;
}

export function mockProvider(
  source: unknown[] | ((req: MockRequest) => unknown),
  options: MockOptions = {},
): LanguageModel {
  const queue = Array.isArray(source) ? [...source] : null;
  return {
    ...(options.decisions ? { [DECISION_MODEL]: true } : {}),
    name: "mock",
    async complete(req) {
      let value: unknown;
      if (queue) {
        if (queue.length === 0) throw new Error("mockProvider queue exhausted");
        value = queue.shift();
      } else {
        value = (source as (req: MockRequest) => unknown)(req);
      }
      return { text: JSON.stringify(value) };
    },
  };
}
