import type { JsonSchema } from "@nola-lang/core";

// When a scalar/array schema is wrapped in the {value} envelope, the schema
// constraint alone only binds providers that do constrained decoding.
// Generate-then-validate backends follow the prompt, so the system turn asks
// for the envelope too.
export const ENVELOPE_NOTE = ' Reply with a JSON object of the form {"value": X}, where X is the requested value.';

/** The schema rendered into the system turn for a backend that cannot enforce it (`structuredOutputs: false`). */
export function schemaNote(schema: JsonSchema): string {
  return `\n\n<schema>\n${JSON.stringify(schema)}\n</schema>\nReply with a single JSON value conforming to the schema.`;
}

/** Follow root-level $ref chains so the envelope decision sees the real shape. */
export function resolveRootRef(schema: JsonSchema): JsonSchema {
  let current = schema;
  const defs = "$defs" in schema ? schema.$defs : undefined;
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
