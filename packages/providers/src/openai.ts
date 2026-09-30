import type { InferRequest, JsonSchema, LanguageModel, RenderedPrompt } from "@nola-lang/core";
import { NolaProviderError, parseRetryAfter, renderPrompt } from "@nola-lang/core";
import { ENVELOPE_NOTE, envelope, resolveRootRef, schemaNote } from "./wire.js";

export interface OpenAiOptions {
  apiKey?: string;
  /** Env var name holding the key. Default: "OPENAI_API_KEY". Value is read lazily at the first request. */
  apiKeyEnv?: string;
  /** Required — there is no default model; every config names its own. */
  model: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  /**
   * Default true: the schema rides the API's structured-output field. false:
   * nothing is sent on the wire and the schema is rendered into the system
   * turn as a <schema> block — for OpenAI-compatible servers that ignore or
   * reject json_schema.
   */
  structuredOutputs?: boolean;
}

type StrictSchema = Record<string, unknown>;

/**
 * Keywords OpenAI's strict mode accepts beside type/enum/structure (its
 * "supported properties" list); anything else is dropped. `format` is
 * forwarded only for the values that list names — an unknown format value is
 * a 400 from the API. minLength/maxLength are NOT forwarded: unverified.
 */
const STRING_KEYWORDS = ["pattern"] as const;
const OPENAI_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "ipv4", "ipv6", "uuid"]);
const NUMBER_KEYWORDS = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"] as const;
const ARRAY_KEYWORDS = ["minItems", "maxItems"] as const;

function pick(schema: object, keys: readonly string[]): StrictSchema {
  const out: StrictSchema = {};
  const s = schema as Record<string, unknown>;
  for (const k of keys) if (s[k] !== undefined) out[k] = s[k];
  return out;
}

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
  // JSDoc descriptions ride every node: since the prompt no longer carries the
  // schema text (prompt-rendering spec 2026-09-28), the wire schema is the only
  // channel a property's description has to the model.
  const described = "description" in schema && schema.description !== undefined ? { description: schema.description } : {};
  // emit 15 shapes: choice passes through; strict mode accepts anyOf.
  // A literal keeps its `const` but gains the `type` it implies: OpenAI-compatible
  // backends (Cerebras) reject a bare `{ const }` node as an unsupported field,
  // and every backend accepts the typed form (it is a strict subset).
  if ("anyOf" in schema) return { ...described, anyOf: schema.anyOf.map(toStrictNode) };
  if ("const" in schema) return { ...described, type: typeof schema.const, const: schema.const };
  switch (schema.type) {
    case "object": {
      if (!("properties" in schema)) {
        return { ...described, type: "object", additionalProperties: toStrictNode(schema.additionalProperties) };
      }
      const properties: Record<string, StrictSchema> = {};
      for (const [key, prop] of Object.entries(schema.properties)) {
        const strict = toStrictNode(prop);
        properties[key] = schema.required.includes(key) ? strict : { anyOf: [strict, { type: "null" }] };
      }
      return {
        ...described,
        type: "object",
        properties,
        required: Object.keys(schema.properties),
        additionalProperties: schema.additionalProperties === false ? false : toStrictNode(schema.additionalProperties),
      };
    }
    case "array":
      if ("prefixItems" in schema) {
        return {
          ...described,
          type: "array",
          prefixItems: schema.prefixItems.map(toStrictNode),
          items: false,
          minItems: schema.minItems,
          maxItems: schema.maxItems,
        };
      }
      return { ...described, type: "array", items: toStrictNode(schema.items), ...pick(schema, ARRAY_KEYWORDS) };
    case "string":
      return {
        ...described,
        type: "string",
        ...(schema.enum ? { enum: [...schema.enum] } : {}),
        ...pick(schema, STRING_KEYWORDS),
        ...(schema.format !== undefined && OPENAI_FORMATS.has(schema.format) ? { format: schema.format } : {}),
      };
    case "number":
    case "integer":
      return { ...described, type: schema.type, ...pick(schema, NUMBER_KEYWORDS) };
    case "null":
      return { type: "null" };
    default:
      return { ...described, type: schema.type };
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
    async infer(req: InferRequest) {
      const requestedAt = Date.now();
      const envName = options.apiKeyEnv ?? "OPENAI_API_KEY";
      const apiKey = options.apiKey ?? process.env[envName];
      if (!apiKey) {
        throw new NolaProviderError(
          `OpenAI API key not found: environment variable ${envName} is not set (checked process.env, including the project .env applied by the Nola loader) and no \`apiKey\` was passed to openai(). Fix: set ${envName}, or pass openai({ apiKeyEnv: "MY_VAR" }) or openai({ apiKey }) in nola.config.ts.`,
          { definitive: true },
        );
      }
      const { system: baseSystem, messages } = renderPrompt(req.intent);
      const output = req.intent.output;
      const reqSchema = output.syntax === "json" ? output.schema : undefined;
      const rootShape = reqSchema === undefined ? undefined : resolveRootRef(reqSchema);
      const enveloped = rootShape !== undefined && !("$ref" in rootShape) && !("type" in rootShape && rootShape.type === "object");
      const transport: JsonSchema | undefined =
        reqSchema === undefined ? undefined : enveloped ? envelope(reqSchema) : reqSchema;
      // structuredOutputs: false — the schema goes into the system turn instead of the wire field
      const enforce = options.structuredOutputs !== false;
      const system = (enveloped ? baseSystem + ENVELOPE_NOTE : baseSystem) + (!enforce && transport ? schemaNote(transport) : "");
      const sent: RenderedPrompt = { system, messages };
      const body: Record<string, unknown> = {
        model,
        messages: [{ role: "system", content: system }, ...messages],
      };
      if (transport && enforce) {
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
          if (recovered !== undefined) return { text: recovered, sent };
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
      if (!reqSchema) return { text: content, sent };
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        throw new NolaProviderError("OpenAI returned non-JSON despite structured outputs.", { cause: e });
      }
      const value = enveloped ? (parsed as { value?: unknown }).value : parsed;
      const durationMs = Date.now() - requestedAt;
      return { text: JSON.stringify(fromStrict(value, reqSchema)), durationMs, sent };
    },
  };
}
