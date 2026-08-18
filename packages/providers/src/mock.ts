import type { NolaProvider, ProviderRequest } from "@nola-lang/core";

export function mockProvider(source: unknown[] | ((req: ProviderRequest) => unknown)): NolaProvider {
  const queue = Array.isArray(source) ? [...source] : null;
  return {
    name: "mock",
    async complete(req) {
      let value: unknown;
      if (queue) {
        if (queue.length === 0) throw new Error("mockProvider queue exhausted");
        value = queue.shift();
      } else {
        value = (source as (req: ProviderRequest) => unknown)(req);
      }
      return { text: JSON.stringify(value) };
    },
  };
}
