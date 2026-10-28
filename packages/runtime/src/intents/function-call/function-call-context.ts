import { Codes } from "@nola-lang/ast";
import { NolaIntentError } from "@nola-lang/core";
import type { InferenceComposer } from "../../ask/composer.js";
import { type AskIdentity, InferContext } from "../../infer-context/infer-context.js";
import type { NolaRuntime } from "../../runtime/index.js";
import type { TypeCarrier } from "../../types/infer-type.js";
import { type FuncPart, type InstructionPart, normalizeParts, referenceText, requireParts, wireParts } from "../parts.js";

export type FunctionCallIntentParams = {
  /** the bare / hinted form: the callee, its name, the arguments — absent in the sequence form, where the func part carries them */
  fn?: unknown;
  name?: string;
  args?: unknown[];
  /** the authored hint, holes already formatted — or the parts of an ask sequence holding exactly one func part (emit 24, spec 2026-10-12 §3.6) */
  instruction?: string | readonly InstructionPart[];
  loc?: string;
  /** compiler-stamped source identity (AskDefinition spec §2); line/col excluded */
  def?: string;
  /** the combined slot carrier — set by forSlots() for the slot-filling ask; never authored */
  slotType?: TypeCarrier<unknown>;
};

/** The call as the intent runs it, whichever form the init took (spec 2026-10-12 §3.6). */
export interface ResolvedCall {
  readonly fn: unknown;
  readonly name: string;
  readonly args: readonly unknown[];
  /** the hint form only */
  readonly hint?: string;
  /** the sequence form only */
  readonly parts?: readonly InstructionPart[];
}

/** The hint form keeps `fn`, `name`, `args` and the hint; the sequence form reads them off its one func part. */
export function resolveCall(params: FunctionCallIntentParams): ResolvedCall {
  if (params.instruction !== undefined && typeof params.instruction !== "string") {
    const parts = normalizeParts(params.instruction);
    requireParts(parts, ["obj", "func"], "FunctionCallIntent");
    const funcs = parts.filter((p): p is FuncPart => typeof p !== "string" && p.kind === "func");
    const f = funcs[0];
    if (funcs.length !== 1 || f === undefined) {
      throw new NolaIntentError(
        "a FunctionCallIntent sequence holds exactly one func part — rebuild the project.",
        Codes.EmitContractMismatch,
      );
    }
    return { fn: f.fn, name: f.name, args: f.args, parts };
  }
  return {
    fn: params.fn,
    name: params.name ?? "",
    args: params.args ?? [],
    ...(params.instruction !== undefined ? { hint: params.instruction } : {}),
  };
}

/**
 * The call intent's own context node — carries the full init, including the
 * live `fn` and `args`. Composes NOTHING until `forSlots()` hands it the
 * combined slot carrier: that node is the ask-site node of the slot-filling
 * ask and composes `intent: "call"` (records-view spec §3.4). Live values
 * never reach prompt text, and call intents mint no frame, so this data
 * never feeds Frame.describe/toTrace.
 */
export class FunctionCallContext extends InferContext<FunctionCallIntentParams> {
  /** the call, resolved from either form */
  readonly call: ResolvedCall;

  constructor(params: FunctionCallIntentParams, runtime: NolaRuntime) {
    super(params, runtime);
    this.call = resolveCall(params);
  }

  /** The node for the slot-filling ask: this init plus the combined slot carrier (one object, one property per slot). */
  forSlots(slotType: TypeCarrier<unknown>): FunctionCallContext {
    return new FunctionCallContext({ ...this.data, slotType }, this.runtime);
  }

  /** The synthesized request the model sees in the hint form — the classic TASK text of a call — or the sequence's reference text. */
  get request(): string {
    if (this.call.parts) return referenceText(this.call.parts);
    const hint = this.call.hint ? ` ${this.call.hint}` : "";
    return `Generate the arguments for calling the function "${this.call.name}".${hint}`;
  }

  override outputType(): TypeCarrier<unknown> | undefined {
    return this.data.slotType;
  }

  override compose(composer: InferenceComposer): void {
    const { slotType } = this.data;
    if (!slotType) return;
    const parts = this.call.parts ? wireParts(this.call.parts) : undefined;
    composer
      .intent("call")
      .input({
        instruction: this.request,
        callee: this.call.name,
        ...(this.call.hint ? { hint: this.call.hint } : {}),
        ...(parts ? { parts } : {}),
      })
      .output(slotType);
  }

  override askIdentity(): AskIdentity {
    const { def } = this.data;
    return {
      kind: "call",
      instruction: this.request,
      callee: this.call.name,
      hint: this.call.hint ?? "",
      ...(def !== undefined ? { def } : {}),
    };
  }
}
