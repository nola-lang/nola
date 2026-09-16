import type { JsonSchema, ValidationIssue } from "@nola-lang/core";
import { type Constraints, checkConstraints } from "../types/constraints.js";

export type ValidationResult<T = unknown> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

type Path = ReadonlyArray<string | number>;

function fail(path: Path, message: string): ValidationResult {
  return { ok: false, issues: [{ path: [...path], message }] };
}

function kindOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/**
 * First failure wins: the correction prompt has always carried exactly one
 * finding, and `formatIssues` renders it to the same `<path>: <message>` text.
 */
export function validate(
  schema: JsonSchema,
  value: unknown,
  path: Path = [],
  defs?: Record<string, JsonSchema>,
): ValidationResult {
  // The root schema may carry the $defs registry; thread it down unchanged.
  const ownDefs = "$defs" in schema ? schema.$defs : undefined;
  const activeDefs = ownDefs ? { ...defs, ...ownDefs } : defs;
  if ("$ref" in schema) {
    const m = /^#\/\$defs\/(.+)$/.exec(schema.$ref);
    const target = m ? activeDefs?.[m[1] as string] : undefined;
    if (!target) return fail(path, `unresolvable $ref '${schema.$ref}'`);
    return validate(target, value, path, activeDefs);
  }
  // emit 15 shapes (the carrier validator is the ask path; this stays the raw-JsonSchema oracle)
  if ("const" in schema) {
    return value === schema.const
      ? { ok: true, value }
      : fail(path, `expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  }
  if ("anyOf" in schema) {
    for (const member of schema.anyOf) {
      const r = validate(member, value, path, activeDefs);
      if (r.ok) return r;
    }
    return fail(path, `value matches none of the ${schema.anyOf.length} alternatives`);
  }
  if (schema.type === "null") {
    return value === null ? { ok: true, value } : fail(path, `expected null, got ${kindOf(value)}`);
  }
  if (schema.type === "array" && "prefixItems" in schema) {
    if (!Array.isArray(value)) return fail(path, `expected array, got ${kindOf(value)}`);
    if (value.length < schema.minItems || value.length > schema.maxItems) {
      return fail(path, `expected ${schema.minItems} to ${schema.maxItems} items, got ${value.length}`);
    }
    for (let i = 0; i < value.length; i++) {
      const r = validate(schema.prefixItems[i] as JsonSchema, value[i], [...path, i], activeDefs);
      if (!r.ok) return r;
    }
    return { ok: true, value };
  }
  if (schema.type === "object" && !("properties" in schema)) {
    if (kindOf(value) !== "object") return fail(path, `expected object, got ${kindOf(value)}`);
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const r = validate(schema.additionalProperties, v, [...path, key], activeDefs);
      if (!r.ok) return r;
    }
    return { ok: true, value };
  }
  switch (schema.type) {
    case "string": {
      if (typeof value !== "string") return fail(path, `expected string, got ${kindOf(value)}`);
      if (schema.enum && !schema.enum.includes(value)) {
        const labels = schema.enum.map((l) => JSON.stringify(l)).join(", ");
        return fail(path, `expected one of ${labels}, got ${JSON.stringify(value)}`);
      }
      if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) {
        return fail(path, `expected an ISO 8601 date-time string, got ${JSON.stringify(value)}`);
      }
      return keywords(schema, value, path);
    }
    case "number":
    case "integer":
      return typeof value === "number" && Number.isFinite(value)
        ? keywords(schema, value, path)
        : fail(path, `expected finite number, got ${kindOf(value)}`);
    case "boolean":
      return typeof value === "boolean" ? { ok: true, value } : fail(path, `expected boolean, got ${kindOf(value)}`);
    case "array": {
      if (!Array.isArray(value)) return fail(path, `expected array, got ${kindOf(value)}`);
      for (let i = 0; i < value.length; i++) {
        const r = validate(schema.items, value[i], [...path, i], activeDefs);
        if (!r.ok) return r;
      }
      return keywords(schema, value, path);
    }
    case "object": {
      if (kindOf(value) !== "object") return fail(path, `expected object, got ${kindOf(value)}`);
      const obj = value as Record<string, unknown>;
      for (const key of schema.required) {
        if (!(key in obj)) return fail(path, `missing required property '${key}'`);
      }
      for (const key of Object.keys(obj)) {
        const propSchema = schema.properties[key] ?? (schema.additionalProperties || undefined);
        if (!propSchema) return fail(path, `unknown property '${key}'`);
        const r = validate(propSchema, obj[key], [...path, key], activeDefs);
        if (!r.ok) return r;
      }
      return { ok: true, value };
    }
    default:
      return fail(path, `unsupported schema ${JSON.stringify(schema)}`);
  }
}

/** emit 16: the constraint keywords — first failure wins, like the rest of this oracle. */
function keywords(schema: JsonSchema, value: unknown, path: Path): ValidationResult {
  const { type, description: _d, $defs: _defs, enum: _e, items: _i, format, ...rest } = schema as Record<string, unknown> & {
    type?: string;
  };
  const c: Constraints = { ...(rest as Constraints), ...(type === "integer" ? { integer: true } : {}) };
  // date-time on a string is the Date wire convention, checked above; every other format is a constraint
  if (typeof format === "string" && format !== "date-time") c.format = format as Constraints["format"];
  let first: string | undefined;
  checkConstraints(value, c, (m) => {
    first ??= m;
  });
  return first === undefined ? { ok: true, value } : fail(path, first);
}
