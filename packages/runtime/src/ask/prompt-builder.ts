import type { JsonSchema, Message } from "@nola-lang/core";
import type { ComposeOptions, InferContext } from "../infer-context/infer-context.js";
import type { Frame } from "../runtime/index.js";
import type { InferenceComposer } from "./composer.js";

/** What one build() pass yields: the composed provider-facing text + wire contract. */
export interface BuiltPrompt {
  messages: Message[];
  schema: JsonSchema;
}

/**
 * Provider-facing assembly strategy: walks the frame chain outer→inner,
 * collects each node's contribution through the InferenceComposer seam, and
 * joins it into one user message plus the output schema.
 */
export class PromptBuilder implements InferenceComposer {
  private readonly texts: string[] = [];
  private schema?: JsonSchema;

  addText(text: string): void {
    this.texts.push(text);
  }

  addSchema(schema: JsonSchema): void {
    this.schema = schema;
  }

  addCorrection(_text: string, _error: string): void {
    throw new Error("Method not implemented.");
  }

  build(frame: Frame, askNode?: InferContext): BuiltPrompt {
    const frames: Frame[] = [];
    for (let f: Frame | undefined = frame; f; f = f.parent) frames.unshift(f);
    type Step = { contributes: boolean; compose: (opts: ComposeOptions) => void };
    const steps: Step[] = frames.map((f) => ({
      contributes: f.infer.contributesText(),
      compose: (opts) => f.composeInferenceData(this, opts),
    }));
    // The ask-site node (extract/call) composes last — it is not a frame.
    if (askNode) {
      steps.push({ contributes: askNode.contributesText(), compose: (opts) => askNode.composeInferenceData(this, opts) });
    }

    // Continuation walk: node i renders with next = "render i+1…" (memoized),
    // so a template can place the remainder itself. hasContext is decided
    // before rendering (some earlier node contributes text) — a bare scope
    // chain contributes nothing and must not claim a "context above".
    const render = (i: number): string => {
      const step = steps[i];
      if (!step) return "";
      let memo: string | undefined;
      const next = () => (memo ??= render(i + 1));
      const hasContext = steps.slice(0, i).some((s) => s.contributes);
      const before = this.texts.length;
      step.compose({ hasContext, next });
      // Each node adds its full text (remainder included) at most once.
      return this.texts.splice(before).join("\n\n");
    };
    const content = render(0);

    return {
      messages: [{ role: "user", content }],
      schema: this.schema ?? { type: "string" },
    };
  }
}
