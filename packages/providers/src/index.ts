import { anthropic } from "./anthropic.js";
import { google } from "./google.js";
import { mockProvider } from "./mock.js";
import { openai } from "./openai.js";
import { typesafe } from "./typesafe.js";

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
export { type MockRequest, mockProvider } from "./mock.js";
export { type OpenAiOptions, openai } from "./openai.js";
export { record, replay } from "./record-replay.js";
export { type TypesafeOptions, typesafe } from "./typesafe.js";

/**
 * Every bring-your-own provider factory, keyed by the name its provider
 * reports. The platform model is not here: `nola.infer()` lives in
 * `@nola-lang/runtime`, the built-in that ships with the runtime.
 */
export const providers = {
  anthropic,
  google,
  openai,
  typesafe,
  mock: mockProvider,
} as const;
