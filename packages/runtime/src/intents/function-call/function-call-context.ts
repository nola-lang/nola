import type { InferenceComposer } from "../../ask/composer.js";
import type { ExtractPromptScope, PromptTemplate } from "../../ask/prompt-render.js";
import { type AskIdentity, InferContext } from "../../infer-context/infer-context.js";
import type { NolaRuntime } from "../../runtime/index.js";
import type { TypeCarrier } from "../../types/infer-type.js";

export type FunctionCallIntentParams = {
  fn: unknown;
  name: string;
  args: unknown[];
  instruction?: string;
  /** lowered `${.member}` hint — replaces the TASK block of the slot-filling ask */
  template?: PromptTemplate<ExtractPromptScope>;
  loc?: string;
  /** compiler-stamped source identity (AskDefinition spec §2); line/col excluded */
  def?: string;
  /** the combined slot carrier — set by forSlots() for the slot-filling ask; never authored */
  slotType?: TypeCarrier<unknown>;
};

/**
 * The call intent's own context node — carries the full init, including the
 * live `fn` and `args`. Composes NOTHING until `forSlots()` hands it the
 * combined slot carrier: that node is the ask-site node of the slot-filling
 * ask and composes `intent: "call"` (records-view spec §3.4). Live values
 * never reach prompt text, and call intents mint no frame, so this data
 * never feeds Frame.describe/toTrace.
 */
export class FunctionCallContext extends InferContext<FunctionCallIntentParams> {
  // biome-ignore lint/complexity/noUselessConstructor: widens the protected base constructor to public
  constructor(params: FunctionCallIntentParams, runtime: NolaRuntime) {
    super(params, runtime);
  }

  /** The node for the slot-filling ask: this init plus the combined slot carrier (one object, one property per slot). */
  forSlots(slotType: TypeCarrier<unknown>): FunctionCallContext {
    return new FunctionCallContext({ ...this.data, slotType }, this.runtime);
  }

  /** The synthesized request the model sees — the classic TASK text of a call, unchanged since the sigil-less spec. */
  get request(): string {
    const hint = this.data.instruction ? ` ${this.data.instruction}` : "";
    return `Generate the arguments for calling the function "${this.data.name}".${hint}`;
  }

  override outputType(): TypeCarrier<unknown> | undefined {
    return this.data.slotType;
  }

  override compose(composer: InferenceComposer): void {
    const { slotType, name, instruction, template } = this.data;
    if (!slotType) return;
    composer
      .intent("call")
      .input({
        instruction: this.request,
        callee: name,
        ...(instruction ? { hint: instruction } : {}),
        ...(template ? { template } : {}),
      })
      .output(slotType);
  }

  override askIdentity(): AskIdentity {
    const { name, instruction, def } = this.data;
    return {
      kind: "call",
      instruction: this.request,
      callee: name,
      hint: instruction ?? "",
      ...(def !== undefined ? { def } : {}),
    };
  }
}
