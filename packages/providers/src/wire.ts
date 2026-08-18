import type { JsonSchema } from "@nola-lang/core";

// When a scalar/array schema is wrapped in the {value} envelope, the schema
// constraint alone only binds providers that do constrained decoding.
// Generate-then-validate backends follow the prompt, so the prompt must ask
// for the envelope too.
export const ENVELOPE_NOTE =
  ' Because the response schema is wrapped, reply with a JSON object of the form {"value": X} where X is the value that conforms to responseSchema.';

/** Follow root-level $ref chains so the envelope decision sees the real shape. */
export function resolveRootRef(schema: JsonSchema): JsonSchema {
  let current = schema;
  const defs = schema.$defs;
  for (let i = 0; i < 32 && "$ref" in current; i++) {
    const name = /^#\/\$defs\/(.+)$/.exec(current.$ref)?.[1];
    const next = name ? defs?.[name] : undefined;
    if (!next) break;
    current = next;
  }
  return current;
}

/** Wrap a non-object schema in the {value} envelope, hoisting $defs to the new root. */
export function envelope(schema: JsonSchema): JsonSchema {
  const { $defs, ...rest } = schema as JsonSchema & { $defs?: Record<string, JsonSchema> };
  return {
    type: "object",
    properties: { value: rest as JsonSchema },
    required: ["value"],
    additionalProperties: false,
    ...($defs ? { $defs } : {}),
  };
}

/** Retry-After is either delta-seconds or an HTTP-date; both become a ms delta. */
export function parseRetryAfter(header: string | null): number | undefined {
  if (header === null || header.trim() === "") return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}
