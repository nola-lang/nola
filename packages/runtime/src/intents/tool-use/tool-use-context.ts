import { Codes } from "@nola-lang/ast";
import { type JsonSchema, NolaIntentError, type ToolDescription } from "@nola-lang/core";
import type { InferenceComposer } from "../../ask/composer.js";
import { wireSchema } from "../../ask/wire-schema.js";
import { type AskIdentity, InferContext } from "../../infer-context/infer-context.js";
import type { NolaRuntime } from "../../runtime/index.js";
import { type InferType, TypeCarrier } from "../../types/infer-type.js";
import { type InstructionPart, normalizeParts, referenceText, requireParts, wireParts } from "../parts.js";
import { materializeTools, type ToolSource } from "./tool-group.js";

/** One entry of a tool list as the loop consumes it: the name the model sees, the callable (a member chain bound to its object), the argument carrier. */
export interface ToolEntry {
  name: string;
  call: (...args: never[]) => unknown;
  /** one object carrier over the parameters, keyed by name in declaration order — the derived contract */
  args: JsonSchema | InferType<unknown>;
}

export type ToolUseIntentParams = {
  /** the authored text, holes already formatted — or the parts of an ask sequence holding one or more tools parts (emit 24, spec 2026-10-12 §3.6) */
  instruction: string | readonly InstructionPart[];
  /** the one-text, one-list shape (lowered as in emit 23): ready entries (hand-written, tests) or the lowered deferred sources; absent in the sequence form */
  tools?: readonly (ToolEntry | ToolSource)[];
  type?: JsonSchema | InferType<unknown>;
  loc?: string;
  /** compiler-stamped source identity (AskDefinition spec §2); line/col excluded */
  def?: string;
};

/** A tool as the model sees it: the schema carries the function's JSDoc summary as its description. */
export function describeTool(tool: ToolEntry): ToolDescription {
  const parameters = wireSchema(tool.args);
  const description = (parameters as { description?: unknown }).description;
  return { name: tool.name, ...(typeof description === "string" ? { description } : {}), parameters };
}

/**
 * The tool-use intent's own context node (spec 2026-10-08 §3.5): the
 * instruction and the answer type as an extractor's, plus the tools offered
 * — the UNION of every list of the ask (spec 2026-10-12 §3.6). The
 * transcript is not here — it is per-ask state the strategy threads turn by
 * turn.
 */
export class ToolUseContext extends InferContext<ToolUseIntentParams> {
  /** the sequence's parts; one text part for the classic form */
  readonly parts: readonly InstructionPart[];

  constructor(params: ToolUseIntentParams, runtime: NolaRuntime) {
    super(params, runtime);
    this.parts = normalizeParts(params.instruction);
    requireParts(this.parts, ["obj", "tools"], "ToolUseIntent");
  }

  private materialized?: ReturnType<typeof materializeTools>;

  /** Every list's sources in written order — the `tools` field first (the one-list shape), then each tools part. */
  private get sources(): readonly (ToolEntry | ToolSource)[] {
    const fromParts = this.parts.flatMap((p) => (typeof p !== "string" && p.kind === "tools" ? [...p.sources] : []));
    return [...(this.data.tools ?? []), ...fromParts];
  }

  /** The sources built once per node; never throws — `entries()` raises the problem on the ask span. */
  private materialize(): ReturnType<typeof materializeTools> {
    this.materialized ??= materializeTools(this.sources);
    return this.materialized;
  }

  /** The entry list the loop consumes; an invalid list is NOLA3022 (spec 2026-10-09 §3.5), raised where the model composes — inside the ask span. */
  entries(): readonly ToolEntry[] {
    const m = this.materialize();
    if (m.error !== undefined) {
      throw new NolaIntentError(`the tool list at ${this.data.loc ?? "?"} cannot be built: ${m.error}`, Codes.ToolListInvalid);
    }
    return m.entries;
  }

  /** The reference text (spec 2026-10-12 §1.6) — the string itself for a one-text ask. */
  get instructionText(): string {
    return referenceText(this.parts);
  }

  override compose(composer: InferenceComposer): void {
    const parts = wireParts(this.parts);
    composer
      .intent("tool-use")
      .input({ instruction: this.instructionText, ...(parts ? { parts } : {}) })
      .output(this.data.type)
      .tools(this.entries().map(describeTool));
  }

  override outputType(): TypeCarrier<unknown> | undefined {
    return TypeCarrier.is(this.data.type) ? this.data.type : undefined;
  }

  override askIdentity(): AskIdentity {
    const { def, type } = this.data;
    const typeText = TypeCarrier.is(type) ? type.toTypeText() : undefined;
    return {
      kind: "tool-use",
      instruction: this.instructionText,
      // on an invalid list the names are empty: askStart still fires, askEnd carries the error
      tools: this.materialize().entries.map((t) => t.name),
      ...(def !== undefined ? { def } : {}),
      ...(typeText !== undefined ? { typeText } : {}),
    };
  }
}
