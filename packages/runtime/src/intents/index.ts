export { ExtractContext, type ExtractIntentParams as ExtractIntentInit } from "./extract/extract-context.js";
export { ExtractIntent } from "./extract/extract-intent.js";
export {
  FunctionCallContext,
  type FunctionCallIntentParams as FunctionCallIntentInit,
} from "./function-call/function-call-context.js";
export { FunctionCallIntent } from "./function-call/function-call-intent.js";
export { Intent, type IntentExecutor, type IntentOptions } from "./intent.js";
export {
  type FunctionArg,
  type FunctionArgInit,
  type FunctionScopeInit,
  InvocationContext,
} from "./invocation/invocation-context.js";

/**
 * Runtime intent detection — checks the `__nolaBrand` instance property, not
 * `instanceof`, so intents from a duplicate runtime copy are still recognized.
 * The predicate is the narrow public tier: every intent is at least Askable.
 */
export function isIntent(v: unknown): v is Askable {
  return IntentClass.isIntent(v);
}
export { ExecutableIntent } from "./executable-intent.js";
export { InvocationIntent } from "./invocation/invocation-intent.js";

import type { Askable, Intent as PublicIntent } from "@nola-lang/core";
import { nolaRuntime } from "../runtime/index.js";
import type { ExtractIntentParams } from "./extract/extract-context.js";
import { ExtractIntent } from "./extract/extract-intent.js";
import type { FunctionCallIntentParams } from "./function-call/function-call-context.js";
import { FunctionCallIntent } from "./function-call/function-call-intent.js";
import { Intent as IntentClass, type IntentExecutor } from "./intent.js";
import type { InvocationContext } from "./invocation/invocation-context.js";
import { InvocationIntent } from "./invocation/invocation-intent.js";

/**
 * Intent factories, keyed by the exact class name — no mapping layer. The
 * declared return types are the PUBLIC tiers, not the classes: this is the
 * seam that keeps class internals (run/spec/reviveValue/__nolaBrand) out of
 * user-facing completion. Extract/call intents are `Askable` (only `ask`
 * resolves them); an infer-function invocation is a thenable `Intent`.
 */
export const intents = {
  Intent<T>(executor: IntentExecutor<T>, ctx: InvocationContext): PublicIntent<T> {
    return new InvocationIntent<T>(executor, ctx);
  },
  ExtractIntent<T = unknown>(params: ExtractIntentParams): Askable<T> {
    return new ExtractIntent<T>(params, nolaRuntime.current());
  },
  FunctionCallIntent<T = unknown>(params: FunctionCallIntentParams): Askable<T> {
    return new FunctionCallIntent<T>(params, nolaRuntime.current());
  },
};
