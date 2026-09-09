import type { InferenceModel, InferenceScope, JsonSchema, ProviderParams, ProviderRequest } from "@nola-lang/core";
import { renderClassic } from "@nola-lang/core";

export interface ModelInit {
  instruction?: string;
  /** undefined → default bare string ({ type: "string" }); null → no schema (free text) */
  schema?: JsonSchema | null;
  system?: string;
  scope?: InferenceScope;
  correction?: { response: string; error: string };
}

/** A minimal extract model — what the runtime's ModelBuilder produces for one ask. */
export function modelOf(init: ModelInit = {}): InferenceModel {
  return {
    intent: "extract",
    input: { instruction: init.instruction ?? "p" },
    ...(init.scope ? { scope: init.scope } : {}),
    ...(init.system !== undefined ? { system: init.system } : {}),
    output: init.schema === null ? { syntax: "json" } : { syntax: "json", schema: init.schema ?? { type: "string" } },
    ...(init.correction ? { correction: init.correction } : {}),
  };
}

export interface RequestInit extends ModelInit {
  params?: ProviderParams;
  /** "classic" (default) hands the provider the rendered ClassicPrompt — what the runtime sends any unbranded provider; "model" hands it the InferenceModel itself. */
  dialect?: "classic" | "model";
}

/** The request as the runtime builds it for a provider of the given dialect. */
export function requestOf(init: RequestInit = {}): ProviderRequest {
  const { params, dialect, ...rest } = init;
  const model = modelOf(rest);
  return { payload: dialect === "model" ? model : renderClassic(model), ...(params ? { params } : {}) };
}
