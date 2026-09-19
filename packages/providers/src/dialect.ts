import type { ChatModel, InferModel, InferRequest, ProviderRequest, ProviderResponse } from "@nola-lang/core";
import { findDecisionQuestions, isInferModel, NolaProviderError, renderClassic } from "@nola-lang/core";

/**
 * The dialect bridge (decision types spec 2026-09-18 §6.2): a combinator is
 * infer-dialect iff any inner is, and renders for its chat inners. `callModel`
 * is the one place that decides which method an inner gets.
 */
export async function callModel(
  model: ChatModel | InferModel,
  req: InferRequest | ProviderRequest,
): Promise<ProviderResponse> {
  if (isInferModel(model)) {
    if ("model" in req) return model.infer(req);
    throw new NolaProviderError(
      `infer-dialect model "${model.name}" received a classic request — a combinator over it must expose infer()`,
      { definitive: true },
    );
  }
  return (model as ChatModel).complete("model" in req ? toClassic(req) : req);
}

/** An infer request rendered for a chat inner: the rendering replaces the model; everything else rides along. */
export function toClassic(req: InferRequest): ProviderRequest {
  const { model, project: _project, ...rest } = req;
  return { payload: renderClassic(model), ...rest };
}

/** True when the request's output schema carries a decision question (either request shape). */
export function isDecisionRequest(req: InferRequest | ProviderRequest): boolean {
  const output = "model" in req ? req.model.output : req.payload.output;
  return output.syntax === "json" && findDecisionQuestions(output.schema).length > 0;
}
