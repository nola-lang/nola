import type { JsonSchema, ProviderRef } from "@nola-lang/core";
import { ExtractIntent, type Frame, nolaRuntime } from "@nola-lang/runtime";

/** Drives the real extract path (ExtractIntent → JsonInference) — ask-path tests thread the same args. */
export function askViaInference(args: {
  frame: Frame;
  prompt: string;
  schema: JsonSchema;
  loc: string;
  pin?: ProviderRef;
}): Promise<unknown> {
  return new ExtractIntent(
    { instruction: args.prompt, type: args.schema, loc: args.loc },
    nolaRuntime.current(),
    args.pin !== undefined ? { provider: args.pin } : {},
  ).run(args.frame);
}
