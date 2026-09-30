import type { JsonSchema } from "@nola-lang/core";
import type { InferenceComposer } from "../../ask/composer.js";
import { type AskIdentity, InferContext } from "../../infer-context/infer-context.js";
import type { NolaRuntime } from "../../runtime/index.js";
import { type InferType, TypeCarrier } from "../../types/infer-type.js";

export type ExtractIntentParams = {
  /** the authored text, holes already formatted */
  instruction: string;
  type?: JsonSchema | InferType<unknown>;
  loc?: string;
  /** compiler-stamped source identity (AskDefinition spec §2); line/col excluded */
  def?: string;
};

/** The extract intent's own context node — carries the authored instruction and target type. */
export class ExtractContext extends InferContext<ExtractIntentParams> {
  // biome-ignore lint/complexity/noUselessConstructor: widens the protected base constructor to public
  constructor(params: ExtractIntentParams, runtime: NolaRuntime) {
    super(params, runtime);
  }

  /** Contributes this ask's IntentInput (instruction) and output type to the composer. */
  override compose(composer: InferenceComposer): void {
    const { instruction, type } = this.data;
    composer.intent("extract").input({ instruction }).output(type);
  }

  override outputType(): TypeCarrier<unknown> | undefined {
    return TypeCarrier.is(this.data.type) ? this.data.type : undefined;
  }

  override askIdentity(): AskIdentity {
    const { instruction, def, type } = this.data;
    const typeText = TypeCarrier.is(type) ? type.toTypeText() : undefined;
    return {
      kind: "extract",
      instruction,
      ...(def !== undefined ? { def } : {}),
      ...(typeText !== undefined ? { typeText } : {}),
    };
  }
}
