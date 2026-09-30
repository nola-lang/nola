import type { InferRequest } from "@nola-lang/core";
import { findDecisionQuestions } from "@nola-lang/core";

/** True when the request's output schema carries a decision question (Choice / Scale / Prob). */
export function isDecisionRequest(req: InferRequest): boolean {
  const output = req.intent.output;
  return output.syntax === "json" && findDecisionQuestions(output.schema).length > 0;
}
