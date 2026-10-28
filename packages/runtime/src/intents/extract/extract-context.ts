import type { JsonSchema } from "@nola-lang/core";
import type { InferenceComposer } from "../../ask/composer.js";
import { type AskIdentity, InferContext } from "../../infer-context/infer-context.js";
import type { NolaRuntime } from "../../runtime/index.js";
import { type InferType, TypeCarrier } from "../../types/infer-type.js";
import { type InstructionPart, normalizeParts, referenceText, requireParts, wireParts } from "../parts.js";

export type ExtractIntentParams = {
  /** the authored text, holes already formatted — or the parts of an ask sequence (emit 24, spec 2026-10-12 §3.6) */
  instruction: string | readonly InstructionPart[];
  type?: JsonSchema | InferType<unknown>;
  loc?: string;
  /** compiler-stamped source identity (AskDefinition spec §2); line/col excluded */
  def?: string;
};

/** The extract intent's own context node — carries the authored instruction (one text, or a sequence's parts) and target type. */
export class ExtractContext extends InferContext<ExtractIntentParams> {
  /** the sequence's parts; one text part for the classic form */
  readonly parts: readonly InstructionPart[];

  constructor(params: ExtractIntentParams, runtime: NolaRuntime) {
    super(params, runtime);
    this.parts = normalizeParts(params.instruction);
    requireParts(this.parts, ["obj"], "ExtractIntent");
  }

  /** The reference text (spec 2026-10-12 §1.6) — the string itself for a one-text ask. */
  get instructionText(): string {
    return referenceText(this.parts);
  }

  /** Contributes this ask's IntentInput (the instruction, the parts when the sequence has values) and output type to the composer. */
  override compose(composer: InferenceComposer): void {
    const parts = wireParts(this.parts);
    composer
      .intent("extract")
      .input({ instruction: this.instructionText, ...(parts ? { parts } : {}) })
      .output(this.data.type);
  }

  override outputType(): TypeCarrier<unknown> | undefined {
    return TypeCarrier.is(this.data.type) ? this.data.type : undefined;
  }

  override askIdentity(): AskIdentity {
    const { def, type } = this.data;
    const typeText = TypeCarrier.is(type) ? type.toTypeText() : undefined;
    return {
      kind: "extract",
      instruction: this.instructionText,
      ...(def !== undefined ? { def } : {}),
      ...(typeText !== undefined ? { typeText } : {}),
    };
  }
}
