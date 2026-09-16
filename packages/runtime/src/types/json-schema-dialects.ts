import { Codes } from "@nola-lang/ast";
import type { JsonSchema } from "@nola-lang/core";
import { NolaSchemaError } from "@nola-lang/core";

/**
 * Dialect conversion for Standard JSON Schema's `target`. The carrier's
 * `toJsonSchema()` is draft 2020-12 and stays the ONE derivation; the other
 * two dialects are pure rewrites of that document, so a new node kind is
 * added once (in `expand`) and lands in every target. A converted document is
 * plain JSON (`Record<string, unknown>`), not `JsonSchema` — the union of
 * shapes core knows is the 2020-12 one.
 */
export const JSON_SCHEMA_TARGETS = ["draft-2020-12", "draft-07", "openapi-3.0"] as const;

type Doc = Record<string, unknown>;

export function toDialect(schema: JsonSchema, target: string): Doc {
  switch (target) {
    case "draft-2020-12":
      return schema;
    case "draft-07":
      return convert(schema, draft07);
    case "openapi-3.0":
      return convert(schema, openapi30);
    default:
      throw new NolaSchemaError(
        `${Codes.SchemaTargetUnsupported}: JSON Schema target '${target}' is not supported (expected one of ${JSON_SCHEMA_TARGETS.map((t) => `'${t}'`).join(", ")})`,
        Codes.SchemaTargetUnsupported,
      );
  }
}

/** A per-node rewrite: receives a node whose CHILDREN are already converted. */
type Rewrite = (node: Doc) => Doc;

/** Root `$defs` → `definitions` (both older dialects), then the node rewrite bottom-up. */
function convert(schema: JsonSchema, rewrite: Rewrite): Doc {
  const { $defs, ...rest } = schema as Doc & { $defs?: Record<string, JsonSchema> };
  const root = walk(rest, rewrite);
  if (!$defs) return root;
  const definitions: Doc = {};
  for (const [name, def] of Object.entries($defs)) definitions[name] = walk(def as Doc, rewrite);
  return { ...root, definitions };
}

function walk(node: Doc, rewrite: Rewrite): Doc {
  const out: Doc = { ...node };
  if (isDoc(out.items)) out.items = walk(out.items, rewrite);
  if (Array.isArray(out.prefixItems)) out.prefixItems = out.prefixItems.map((i) => walk(i as Doc, rewrite));
  if (Array.isArray(out.anyOf)) out.anyOf = out.anyOf.map((m) => walk(m as Doc, rewrite));
  if (isDoc(out.additionalProperties)) out.additionalProperties = walk(out.additionalProperties, rewrite);
  if (isDoc(out.properties)) {
    const props: Doc = {};
    for (const [key, prop] of Object.entries(out.properties)) props[key] = walk(prop as Doc, rewrite);
    out.properties = props;
  }
  if (typeof out.$ref === "string") out.$ref = out.$ref.replace(/^#\/\$defs\//, "#/definitions/");
  return rewrite(out);
}

function isDoc(v: unknown): v is Doc {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Both older dialects ignore every sibling of `$ref` (a constrained or
 * described cyclic ref, emit 16): the ref moves into `allOf` so the
 * siblings apply.
 */
function liftRefSiblings(node: Doc): Doc {
  if (typeof node.$ref !== "string" || Object.keys(node).length === 1) return node;
  const { $ref, ...rest } = node;
  return { allOf: [{ $ref }], ...rest };
}

/** draft-07 has no `prefixItems`: a tuple is `items: [...]` + `additionalItems: false`. */
const draft07: Rewrite = (node) => {
  if (Array.isArray(node.prefixItems)) {
    const { prefixItems, items: _closed, ...rest } = node;
    return { ...rest, items: prefixItems, additionalItems: false };
  }
  return liftRefSiblings(node);
};

/**
 * OpenAPI 3.0 (draft-04 lineage): no `const` (a one-element `enum`), no
 * `type: "null"` (`nullable: true` on the other branch), no tuples (an array
 * of the elements' union with the same length bounds).
 */
const openapi30: Rewrite = (node) => {
  if ("const" in node) {
    const { const: value, ...rest } = node;
    return { ...rest, enum: [value] };
  }
  // exclusive bounds are booleans beside `minimum` / `maximum` in 3.0 (draft-04 form)
  if (typeof node.exclusiveMinimum === "number" || typeof node.exclusiveMaximum === "number") {
    const { exclusiveMinimum, exclusiveMaximum, ...rest } = node;
    return {
      ...rest,
      ...(typeof exclusiveMinimum === "number" ? { minimum: exclusiveMinimum, exclusiveMinimum: true } : {}),
      ...(typeof exclusiveMaximum === "number" ? { maximum: exclusiveMaximum, exclusiveMaximum: true } : {}),
    };
  }
  if (Array.isArray(node.prefixItems)) {
    const { prefixItems, items: _closed, ...rest } = node;
    const elements = dedupe(prefixItems as Doc[]);
    return { ...rest, items: elements.length === 1 ? (elements[0] as Doc) : { anyOf: elements } };
  }
  if (Array.isArray(node.anyOf)) {
    const members = node.anyOf as Doc[];
    const rest = members.filter((m) => m.type !== "null");
    if (rest.length === members.length) return node;
    const { anyOf: _members, ...outer } = node;
    return rest.length === 1 ? { ...(rest[0] as Doc), ...outer, nullable: true } : { ...outer, anyOf: rest, nullable: true };
  }
  return liftRefSiblings(node);
};

function dedupe(docs: Doc[]): Doc[] {
  const seen = new Set<string>();
  return docs.filter((d) => {
    const key = JSON.stringify(d);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
