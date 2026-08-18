export { ExtractInferContext, ExtractIntent, type ExtractIntentParams as ExtractIntentInit } from "./extract-intent.js";
export {
  FunctionCallingInferContext,
  FunctionCallingIntent,
  type FunctionCallingIntentParams as FunctionCallingIntentInit,
} from "./function-calling-intent.js";
export { Intent, type IntentExecutor, type IntentOptions } from "./intent.js";

/**
 * Runtime intent detection — checks the `__nolaBrand` instance property, not
 * `instanceof`, so intents from a duplicate runtime copy are still recognized.
 * The predicate is the narrow public tier: every intent is at least Askable.
 */
export function isIntent(v: unknown): v is Askable {
  return IntentClass.isIntent(v);
}
export { ExecutableIntent } from "./executable-intent.js";
export { InvocationIntent } from "./invocation-intent.js";

import type { Askable, Intent as PublicIntent } from "@nola-lang/core";
import type { FunctionInferContext } from "../infer-context/index.js";
import { nolaRuntime } from "../runtime/index.js";
import { ExtractIntent, type ExtractIntentParams } from "./extract-intent.js";
import { FunctionCallingIntent, type FunctionCallingIntentParams } from "./function-calling-intent.js";
import { Intent as IntentClass, type IntentExecutor } from "./intent.js";
import { InvocationIntent } from "./invocation-intent.js";

/**
 * Intent factories, keyed by the exact class name — no mapping layer. The
 * declared return types are the PUBLIC tiers, not the classes: this is the
 * seam that keeps class internals (run/spec/reviveValue/__nolaBrand) out of
 * user-facing completion. Extract/call intents are `Askable` (only `ask`
 * resolves them); an infer-function invocation is a thenable `Intent`.
 */
export const intents = {
  Intent<T>(executor: IntentExecutor<T>, ctx: FunctionInferContext): PublicIntent<T> {
    return new InvocationIntent<T>(executor, ctx);
  },
  ExtractIntent<T = unknown>(params: ExtractIntentParams): Askable<T> {
    return new ExtractIntent<T>(params, nolaRuntime.current());
  },
  FunctionCallingIntent<T = unknown>(params: FunctionCallingIntentParams): Askable<T> {
    return new FunctionCallingIntent<T>(params, nolaRuntime.current());
  },
};
