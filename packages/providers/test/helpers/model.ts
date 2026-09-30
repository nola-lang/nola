import type { InferenceModel, InferenceScope, InferRequest, JsonSchema, ProviderParams } from "@nola-lang/core";

export interface ModelInit {
  instruction?: string;
  /** undefined → default bare string ({ type: "string" }); null → no schema (free text) */
  schema?: JsonSchema | null;
  system?: string;
  scope?: InferenceScope;
  correction?: { response: string; error: string };
}

/** A minimal extract intent — what the runtime's ModelBuilder produces for one ask. */
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
  profile?: string;
}

/** The request as the runtime builds it for any model: the intent plus params and profile. */
export function requestOf(init: RequestInit = {}): InferRequest {
  const { params, profile, ...rest } = init;
  return { intent: modelOf(rest), ...(params ? { params } : {}), ...(profile !== undefined ? { profile } : {}) };
}
