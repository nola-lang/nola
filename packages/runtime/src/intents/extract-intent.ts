import { type JsonSchema, Site } from "@nola-lang/core";
import type { InferenceComposer } from "../ask/composer.js";
import { JsonInference } from "../ask/inference-json.js";
import {
  type ExtractPromptData,
  type ExtractPromptScope,
  extractFormat,
  isTrivialStringSchema,
  joinBlocks,
  type PromptTemplate,
  renderTemplate,
} from "../ask/prompt-render.js";
import { type ComposeOptions, InferContext } from "../infer-context/index.js";
import { type Frame, type NolaRuntime, nolaRuntime } from "../runtime/index.js";
import { InferType } from "../types/infer-type.js";
import { ExecutableIntent } from "./executable-intent.js";
import type { Intent, IntentOptions } from "./intent.js";

export type ExtractIntentParams = {
  /** the authored text; for a template, the raw literal text with its holes verbatim */
  instruction: string;
  /** lowered `${.member}` prompt — replaces the TASK block when present */
  template?: PromptTemplate<ExtractPromptScope>;
  type?: JsonSchema | InferType<unknown>;
  loc?: string;
};

/** The wire contract: undefined → free text, InferType → derived JSON schema. */
export function wireSchema(type?: JsonSchema | InferType<unknown>): JsonSchema {
  return type === undefined ? { type: "string" } : InferType.isInferType(type) ? type.toJsonSchema() : type;
}

/** The extract intent's own context node — carries the authored instruction and target type. */
export class ExtractInferContext extends InferContext<ExtractIntentParams> {
  // biome-ignore lint/complexity/noUselessConstructor: widens the protected base constructor to public
  constructor(params: ExtractIntentParams, runtime: NolaRuntime) {
    super(params, runtime);
  }

  /**
   * TASK renders last (the walk is outer→inner). The node assembles
   * ExtractPromptData and registers the wire schema; the runtime's
   * PromptRenderer owns the wording (defaultPromptRenderer is the canonical
   * text). Text-only providers never see the output channel, so the schema
   * travels in the text too.
   */
  override contributesText(): boolean {
    return true;
  }

  override composeInferenceData(composer: InferenceComposer, opts?: ComposeOptions): void {
    const schema = wireSchema(this.data.type);
    composer.addSchema(schema);
    const data: ExtractPromptData = {
      kind: "extract",
      instruction: this.data.instruction,
      schema,
      trivialString: isTrivialStringSchema(schema),
      hasContext: opts?.hasContext ?? false,
    };
    const renderer = this.runtime.promptRenderer;
    let memo: string | undefined;
    const rest = () => (memo ??= opts?.next?.() ?? "");
    const { template } = this.data;
    if (!template) {
      composer.addText(joinBlocks(renderer.extract(data), rest()));
      return;
    }
    // The implicit tail of an extractor template is the response discipline
    // (not the remainder — this node is the leaf; the remainder still follows).
    let formatRead = false;
    const typeText = InferType.isInferType(this.data.type) ? this.data.type.toNativeType() : JSON.stringify(schema);
    const scope: ExtractPromptScope = Object.freeze({
      type: typeText,
      schema: JSON.stringify(schema),
      hasContext: data.hasContext,
      get default() {
        return renderer.extract(data);
      },
      get format() {
        formatRead = true;
        return extractFormat(data);
      },
    });
    const site = `${this.sourceFile()}:${this.data.loc ?? "?"}`;
    const text = renderTemplate(template, scope, site, () => extractFormat(data), () => formatRead);
    composer.addText(joinBlocks(text, rest()));
  }
}

export class ExtractIntent<T = unknown> extends ExecutableIntent<T, ExtractInferContext> {
  constructor(props: ExtractIntentParams, runtime: NolaRuntime = nolaRuntime.current(), options: IntentOptions = {}) {
    super(new ExtractInferContext(props, runtime), options);
  }

  /** Preserve the concrete type so options (e.g. a provider pin) reach execute(). */
  protected override clone(patch: Partial<IntentOptions>): Intent<T> {
    return new ExtractIntent<T>(this.inferContext.data, this.runtime, { ...this.options, ...patch });
  }

  /** The derived wire contract — call intents combine slot specs into one ask. */
  get spec(): { instruction: string; schema: JsonSchema } {
    return { instruction: this.inferContext.data.instruction, schema: wireSchema(this.inferContext.data.type) };
  }

  /** Post-validation wire→value transform (e.g. ISO strings → Date); call-intent slots use it too. */
  reviveValue(value: unknown): unknown {
    const s = this.inferContext.data.type;
    return InferType.isInferType(s) ? s.revive(value) : value;
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

    const value = this.reviveValue(raw);

    frame.history.push({
      prompt: context.data.instruction,
      value
    });

    return value as T;
  }
}
