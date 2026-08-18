import type { Frame } from "../runtime/frame.js";
import { type CorrectionRequest, Inference, type InferParams } from "./inference.js";
import { PromptBuilder } from "./prompt-builder.js";
import { type ValidationResult, validate } from "./validate.js";

/** Phase 1 strategy: JSON wire syntax, JSON.parse, JSON-schema validation. */

export class JsonInference extends Inference {

  protected composeInferParams(frame: Frame): InferParams {
    const { messages, schema } = new PromptBuilder().build(frame, this.request.context);

    return {
      messages,
      output: {
        syntax: "json",
        schema
      }
    };
  }

  protected override parse(text: string): ValidationResult {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch {
      return { ok: false, error: `reply is not valid JSON: ${text.slice(0, 120)}` };
    }
  }

  protected override validateResult(value: unknown): ValidationResult {
    const { output } = this.inferParams;
    const schema = output.syntax === "json" ? output.schema : undefined;
    return schema ? validate(schema, value) : { ok: true, value };
  }

  protected override correctionRequest({ response, error }: CorrectionRequest): InferParams {
    const { messages, output } = this.inferParams;
    return {
      messages: [
        ...messages,
        { role: "assistant", content: response },
        {
          role: "user",
          content: `Your previous reply was invalid: ${error}. Reply again with JSON strictly conforming to responseSchema.`,
        },
      ],
      output,
    };
  }
}
