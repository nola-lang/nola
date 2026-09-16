import { type JsonSchema, Site } from "@nola-lang/core";
import { JsonInference } from "../../ask/inference-json.js";
import { wireSchema } from "../../ask/wire-schema.js";
import { type Frame, type NolaRuntime, nolaRuntime } from "../../runtime/index.js";
import type { TypeCarrier } from "../../types/infer-type.js";
import { ExecutableIntent } from "../executable-intent.js";
import type { Intent, IntentOptions } from "../intent.js";
import { ExtractContext, type ExtractIntentParams } from "./extract-context.js";

export { wireSchema } from "../../ask/wire-schema.js";

export class ExtractIntent<T = unknown> extends ExecutableIntent<T, ExtractContext> {
  constructor(props: ExtractIntentParams, runtime: NolaRuntime = nolaRuntime.current(), options: IntentOptions = {}) {
    super(new ExtractContext(props, runtime), options);
  }

  /** Preserve the concrete type so options (e.g. a provider pin) reach execute(). */
  protected override clone(patch: Partial<IntentOptions>): Intent<T> {
    return new ExtractIntent<T>(this.inferContext.data, this.runtime, { ...this.options, ...patch });
  }

  /** The carrier this extractor validates against (undefined for the raw-JsonSchema seam); call intents combine slot carriers into one ask. */
  slotType(): TypeCarrier<unknown> | undefined {
    return this.inferContext.outputType();
  }

  /** The derived wire contract — call intents combine slot specs into one ask. */
  get spec(): { instruction: string; schema: JsonSchema } {
    return { instruction: this.inferContext.data.instruction, schema: wireSchema(this.inferContext.data.type) };
  }

  protected async execute(frame: Frame): Promise<T> {
    const { inferContext: context, options } = this;

    // No strategy layer for now — each intent picks its Inference directly.
    const raw = await new JsonInference({
      frame,
      site: new Site(frame.sourceFile(), context.data.loc ?? "?"),
      options,
      context,
    }).infer();

    const value = raw; // already revived: the carrier validator checks and revives in one pass

    frame.history.push({
      prompt: context.data.instruction,
      value
    });

    return value as T;
  }
}
