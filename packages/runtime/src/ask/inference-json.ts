import type { InferenceModel } from "@nola-lang/core";
import { validateCarrier } from "../types/validate-carrier.js";
import { type CorrectionRequest, Inference } from "./inference.js";
import { type ValidationResult, validate } from "./validate.js";

/** Phase 1 strategy: JSON wire syntax, JSON.parse, JSON-schema validation. */
export class JsonInference extends Inference {
  protected override parse(text: string): ValidationResult {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch {
      return { ok: false, issues: [{ path: [], message: `reply is not valid JSON: ${text.slice(0, 120)}` }] };
    }
  }

  protected override validateResult(value: unknown, model: InferenceModel): ValidationResult {
    // Carrier-driven (emit 15): every issue in one pass, value revived on
    // success. The raw-JsonSchema branch serves the `type: JsonSchema` seam only.
    const carrier = this.task.context.outputType();
    if (carrier) return validateCarrier(carrier, value);
    const schema = model.output.syntax === "json" ? model.output.schema : undefined;
    return schema ? validate(schema, value) : { ok: true, value };
  }

  /** The correction turn is data on the model; renderClassic phrases it for chat dialects. */
  protected override correctionRequest({ response, error }: CorrectionRequest, model: InferenceModel): InferenceModel {
    return { ...model, correction: { response, error } };
  }
}
