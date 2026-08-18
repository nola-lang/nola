import { anthropic } from "./anthropic.js";
import { google } from "./google.js";
import { mockProvider } from "./mock.js";
import { openai } from "./openai.js";

export { type AnthropicOptions, anthropic } from "./anthropic.js";
export {
  constant,
  exponential,
  fallback,
  isDefinitiveProviderError,
  type RetryPolicy,
  roundRobin,
  withRetry,
} from "./combinators.js";
export { type GoogleOptions, google } from "./google.js";
export { mockProvider } from "./mock.js";
export { type OpenAiOptions, openai } from "./openai.js";
export { record, replay } from "./record-replay.js";

/** Every built-in provider factory, keyed by the name its provider reports. */
export const providers = {
  anthropic,
  google,
  openai,
  mock: mockProvider,
} as const;
