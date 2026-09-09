import type { JsonSchema, ModelRef } from "@nola-lang/core";
import { ExtractIntent, type Frame, nolaRuntime } from "@nola-lang/runtime";

/** Drives the real extract path (ExtractIntent → JsonInference) — ask-path tests thread the same args. */
export function askViaInference(args: {
  frame: Frame;
  prompt: string;
  schema: JsonSchema;
  loc: string;
  pin?: ModelRef;
  def?: string;
}): Promise<unknown> {
  return new ExtractIntent(
    { instruction: args.prompt, type: args.schema, loc: args.loc, ...(args.def !== undefined ? { def: args.def } : {}) },
    nolaRuntime.current(),
    args.pin !== undefined ? { model: args.pin } : {},
  ).run(args.frame);
}
