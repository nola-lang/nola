import type { LanguageModel, ProviderRequest } from "@nola-lang/core";

/** What a mock callback sees: the classic request — `payload` IS the rendering (reshape 2026-09-01). */
export type MockRequest = ProviderRequest;

export function mockProvider(source: unknown[] | ((req: MockRequest) => unknown)): LanguageModel {
  const queue = Array.isArray(source) ? [...source] : null;
  return {
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
