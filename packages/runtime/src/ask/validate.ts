import type { JsonSchema } from "@nola-lang/core";

export type ValidationResult = { ok: true; value: unknown } | { ok: false; error: string };

function kindOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

export function validate(
  schema: JsonSchema,
  value: unknown,
  path = "$",
  defs?: Record<string, JsonSchema>,
): ValidationResult {
  // The root schema may carry the $defs registry; thread it down unchanged.
  const activeDefs = schema.$defs ? { ...defs, ...schema.$defs } : defs;
  if ("$ref" in schema) {
    const m = /^#\/\$defs\/(.+)$/.exec(schema.$ref);
    const target = m ? activeDefs?.[m[1] as string] : undefined;
    if (!target) return { ok: false, error: `${path}: unresolvable $ref '${schema.$ref}'` };
    return validate(target, value, path, activeDefs);
  }
  switch (schema.type) {
    case "string": {
      if (typeof value !== "string") return { ok: false, error: `${path}: expected string, got ${kindOf(value)}` };
      if (schema.enum && !schema.enum.includes(value)) {
        const labels = schema.enum.map((l) => JSON.stringify(l)).join(", ");
        return { ok: false, error: `${path}: expected one of ${labels}, got ${JSON.stringify(value)}` };
      }
      if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) {
        return { ok: false, error: `${path}: expected an ISO 8601 date-time string, got ${JSON.stringify(value)}` };
      }
      return { ok: true, value };
    }
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? { ok: true, value }
        : { ok: false, error: `${path}: expected finite number, got ${kindOf(value)}` };
    case "boolean":
      return typeof value === "boolean"
        ? { ok: true, value }
        : { ok: false, error: `${path}: expected boolean, got ${kindOf(value)}` };
    case "array": {
      if (!Array.isArray(value)) return { ok: false, error: `${path}: expected array, got ${kindOf(value)}` };
      for (let i = 0; i < value.length; i++) {
        const r = validate(schema.items, value[i], `${path}[${i}]`, activeDefs);
        if (!r.ok) return r;
      }
      return { ok: true, value };
    }
    case "object": {
      if (kindOf(value) !== "object") return { ok: false, error: `${path}: expected object, got ${kindOf(value)}` };
      const obj = value as Record<string, unknown>;
      for (const key of schema.required) {
        if (!(key in obj)) return { ok: false, error: `${path}: missing required property '${key}'` };
      }
      for (const key of Object.keys(obj)) {
        const propSchema = schema.properties[key];
        if (!propSchema) return { ok: false, error: `${path}: unknown property '${key}'` };
        const r = validate(propSchema, obj[key], `${path}.${key}`, activeDefs);
        if (!r.ok) return r;
      }
      return { ok: true, value };
    }
  }
}
