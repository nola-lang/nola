import type { JsonSchema, ModelRef } from "@nola-lang/core";
import { ExtractIntent, type Frame, nolaRuntime } from "@nola-lang/runtime";
// internal — the runtime index does not re-export the record types
import type { VisibleContext } from "../../src/infer-context/index.js";

/** Drives the real extract path (ExtractIntent → JsonInference) — ask-path tests thread the same args. */
export function askViaInference(args: {
  frame: Frame;
  prompt: string;
  schema: JsonSchema;
  loc: string;
  pin?: ModelRef;
  def?: string;
  /** what the ask site sees — the context items and bindings `ask` would pass */
  visible?: VisibleContext;
}): Promise<unknown> {
  return new ExtractIntent(
    { instruction: args.prompt, type: args.schema, loc: args.loc, ...(args.def !== undefined ? { def: args.def } : {}) },
    nolaRuntime.current(),
    {
      ...(args.pin !== undefined ? { model: args.pin } : {}),
      ...(args.visible !== undefined ? { visible: args.visible } : {}),
    },
  ).run(args.frame);
}
