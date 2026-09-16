import type { JsonSchema, LanguageModel } from "@nola-lang/core";
import { NolaProviderError, parseRetryAfter } from "@nola-lang/core";
import { ENVELOPE_NOTE, envelope, resolveRootRef } from "./wire.js";

export interface OpenAiOptions {
  apiKey?: string;
  /** Env var name holding the key. Default: "OPENAI_API_KEY". Value is read lazily at the first request. */
  apiKeyEnv?: string;
  /** Required — there is no default model; every config names its own. */
  model: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

type StrictSchema = Record<string, unknown>;

/** Strict mode requires every property required; optionals become anyOf [T, null]. */
function toStrict(schema: JsonSchema): StrictSchema {
  const out = toStrictNode(schema);
  // $defs only ever appears at the root of our emissions; transform each def
  // through the same strict rewrite so refs resolve to strict shapes.
  const rootDefs = "$defs" in schema ? schema.$defs : undefined;
  if (rootDefs) {
    const defs: Record<string, StrictSchema> = {};
    for (const [key, def] of Object.entries(rootDefs)) defs[key] = toStrictNode(def);
    out.$defs = defs;
  }
  return out;
}

function toStrictNode(schema: JsonSchema): StrictSchema {
  if ("$ref" in schema) return { $ref: schema.$ref };
  // emit 15 shapes: choice and literals pass through; strict mode accepts anyOf/const
  if ("anyOf" in schema) return { anyOf: schema.anyOf.map(toStrictNode) };
  if ("const" in schema) return { const: schema.const };
  switch (schema.type) {
    case "object": {
      if (!("properties" in schema)) {
        return { type: "object", additionalProperties: toStrictNode(schema.additionalProperties) };
      }
      const properties: Record<string, StrictSchema> = {};
      for (const [key, prop] of Object.entries(schema.properties)) {
        const strict = toStrictNode(prop);
        properties[key] = schema.required.includes(key) ? strict : { anyOf: [strict, { type: "null" }] };
      }
      return {
        type: "object",
        properties,
        required: Object.keys(schema.properties),
        additionalProperties: schema.additionalProperties === false ? false : toStrictNode(schema.additionalProperties),
      };
    }
    case "array":
      if ("prefixItems" in schema) {
        return {
          type: "array",
          prefixItems: schema.prefixItems.map(toStrictNode),
          items: false,
          minItems: schema.minItems,
          maxItems: schema.maxItems,
        };
      }
      return { type: "array", items: toStrictNode(schema.items) };
    case "null":
      return { type: "null" };
    default:
      return schema.type === "string" && schema.enum
        ? { type: "string", enum: [...schema.enum] }
        : { type: schema.type };
  }
}

/**
 * Generate-then-validate backends return HTTP 400 `json_validate_failed` with the
 * model's raw output in `error.failed_generation`. When that output is actually the
 * answer (just unwrapped, or wrapped when we expected bare), recover it instead of
 * hard-failing; the context layer re-validates it against the real schema.
 */
function recoverFailedGeneration(errorBody: string, enveloped: boolean, schema: JsonSchema): string | undefined {
  let failed: unknown;
  try {
    failed = (JSON.parse(errorBody) as { error?: { failed_generation?: unknown } }).error?.failed_generation;
  } catch {
    return undefined;
  }
  if (typeof failed !== "string") return undefined;
  let gen: unknown;
  try {
    gen = JSON.parse(failed);
  } catch {
    return undefined;
  }
  const wrapped = enveloped && gen !== null && typeof gen === "object" && !Array.isArray(gen) && "value" in gen;
  const value = wrapped ? (gen as { value: unknown }).value : gen;
  return JSON.stringify(fromStrict(value, schema));
}

/** Remove null-valued optionals the strict transport introduced. */
function fromStrict(value: unknown, schema: JsonSchema, defs?: Record<string, JsonSchema>): unknown {
  const ownDefs = "$defs" in schema ? schema.$defs : undefined;
  const activeDefs = ownDefs ? { ...defs, ...ownDefs } : defs;
  if ("$ref" in schema) {
    const name = /^#\/\$defs\/(.+)$/.exec(schema.$ref)?.[1];
    const target = name ? activeDefs?.[name] : undefined;
    // Data-driven recursion: each step consumes value structure, so it terminates.
    return target ? fromStrict(value, target, activeDefs) : value;
  }
  if ("anyOf" in schema || "const" in schema) return value;
  if (
    schema.type === "object" &&
    "properties" in schema &&
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  ) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const propSchema = schema.properties[key];
      if (v === null && propSchema && !schema.required.includes(key)) continue;
      out[key] = propSchema ? fromStrict(v, propSchema, activeDefs) : v;
    }
    return out;
  }
  if (schema.type === "array" && "items" in schema && schema.items !== false && Array.isArray(value)) {
    const items = schema.items;
    return value.map((item) => fromStrict(item, items, activeDefs));
  }
  return value;
}

/** A bare model string is shorthand for `{ model }` — every other option defaulted. */
export function openai(optionsOrModel: OpenAiOptions | string): LanguageModel {
  const options = typeof optionsOrModel === "string" ? { model: optionsOrModel } : optionsOrModel;
  const doFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = options.model;
  return {
    name: "openai",
    async complete(req) {
      const requestedAt = Date.now();
      const envName = options.apiKeyEnv ?? "OPENAI_API_KEY";
      const apiKey = options.apiKey ?? process.env[envName];
      if (!apiKey) {
        throw new NolaProviderError(
          `OpenAI API key not found: environment variable ${envName} is not set (checked process.env, including the project .env applied by the Nola loader) and no \`apiKey\` was passed to openai(). Fix: set ${envName}, or pass openai({ apiKeyEnv: "MY_VAR" }) or openai({ apiKey }) in nola.config.ts.`,
          { definitive: true },
        );
      }
      const { system: baseSystem, messages, output } = req.payload;
      const reqSchema = output.syntax === "json" ? output.schema : undefined;
      const rootShape = reqSchema === undefined ? undefined : resolveRootRef(reqSchema);
      const enveloped = rootShape !== undefined && !("$ref" in rootShape) && !("type" in rootShape && rootShape.type === "object");
      const transport: JsonSchema | undefined =
        reqSchema === undefined ? undefined : enveloped ? envelope(reqSchema) : reqSchema;
      const system = enveloped ? baseSystem + ENVELOPE_NOTE : baseSystem;
      const body: Record<string, unknown> = {
        model,
        messages: [{ role: "system", content: system }, ...messages],
      };
      if (transport) {
        body.response_format = {
          type: "json_schema",
          json_schema: { name: "nola_extraction", strict: true, schema: toStrict(transport) },
        };
      }
      const res = await doFetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: req.signal ?? null,
      });
      if (!res.ok) {
        const errorBody = await res.text();
        if (reqSchema !== undefined) {
          const recovered = recoverFailedGeneration(errorBody, enveloped, reqSchema);
          if (recovered !== undefined) return { text: recovered };
        }
        throw new NolaProviderError(
          `OpenAI request failed: ${res.status} ${res.statusText} — ${errorBody.slice(0, 500)}`,
          {
            status: res.status,
            retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
          },
        );
      }
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new NolaProviderError("OpenAI response had no message content.");
      if (!reqSchema) return { text: content };
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        throw new NolaProviderError("OpenAI returned non-JSON despite structured outputs.", { cause: e });
      }
      const value = enveloped ? (parsed as { value?: unknown }).value : parsed;
      const durationMs = Date.now() - requestedAt;
      return { text: JSON.stringify(fromStrict(value, reqSchema)), durationMs };
    },
  };
}
