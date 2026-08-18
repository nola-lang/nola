import { Codes } from "@nola-lang/ast";
import type { JsonSchema } from "@nola-lang/core";
import { NolaSchemaError } from "@nola-lang/core";

export const INFER_TYPE_BRAND = "nola.infertype" as const;

type TypeNode =
  | { kind: "string"; labels?: readonly string[] }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "date" }
  | { kind: "array"; item: InferType<unknown> }
  | { kind: "object"; props: Record<string, InferType<unknown>> }
  | { kind: "optional"; inner: InferType<unknown> }
  | { kind: "ref"; name: string; resolve: () => InferType<unknown> }
  | { kind: "unsupported"; reason: string };

/**
 * Schema carrier for emit contract 5 (spec §5a). Pure and immutable; the
 * provider/validator/fingerprint seams keep consuming JsonSchema — this class
 * only changes the carrier. toJsonSchema() inlines every non-cyclic ref so the
 * output is canonically identical to the emit-4 inline derivation; only refs
 * that participate in a cycle serialize as root $defs + $ref pointers.
 */
export class InferType<T = unknown> {
  static isInferType(v: unknown): v is InferType<unknown> {
    return (
      typeof v === "object" && v !== null && (v as { __nolaTypeBrand?: unknown }).__nolaTypeBrand === INFER_TYPE_BRAND
    );
  }

  readonly __nolaTypeBrand = INFER_TYPE_BRAND;

  constructor(
    private readonly node: TypeNode,
    private readonly description?: string,
  ) {}

  describe(text: string): InferType<T> {
    return new InferType<T>(this.node, text);
  }

  toJsonSchema(): JsonSchema {
    const cyclic = new Set<string>();
    findCycles(this, new Set(), new Set(), cyclic);
    const defs: Record<string, JsonSchema> = {};
    const building = new Set<string>();
    const root = expand(this, cyclic, defs, building);
    return Object.keys(defs).length > 0 ? ({ ...root, $defs: defs } as JsonSchema) : root;
  }

  toString(): string {
    return JSON.stringify(this.toJsonSchema(), null, 2);
  }

  toNativeType(): string {
    return this._node.kind === "ref" ? this._node.resolve().toNativeType() : this._node.kind;
  }

  /**
   * Post-validation wire→value transform: date leaves become Date instances.
   * Identity (same reference) when no date is reachable in the type. The walk
   * follows the (finite, JSON-derived) VALUE, so cyclic ref types terminate.
   */
  revive(value: unknown): unknown {
    return hasRevivable(this, new Set()) ? reviveValue(this, value) : value;
  }

  /** internal accessors for the expander (keep the public surface minimal) */
  get _node(): TypeNode {
    return this.node;
  }
  get _description(): string | undefined {
    return this.description;
  }
}

/** Ref names reachable through themselves are cyclic; visit each name once. */
function findCycles(t: InferType<unknown>, stack: Set<string>, visited: Set<string>, cyclic: Set<string>): void {
  const n = t._node;
  switch (n.kind) {
    case "array":
      findCycles(n.item, stack, visited, cyclic);
      return;
    case "optional":
      findCycles(n.inner, stack, visited, cyclic);
      return;
    case "object":
      for (const p of Object.values(n.props)) findCycles(p, stack, visited, cyclic);
      return;
    case "ref": {
      if (stack.has(n.name)) {
        cyclic.add(n.name);
        return;
      }
      if (visited.has(n.name)) return;
      visited.add(n.name);
      stack.add(n.name);
      findCycles(n.resolve(), stack, visited, cyclic);
      stack.delete(n.name);
      return;
    }
    default:
      // scalars and unsupported carry no children
      return;
  }
}

/** Any date leaf reachable? Visits each ref name once, so cycles terminate. */
function hasRevivable(t: InferType<unknown>, visited: Set<string>): boolean {
  const n = t._node;
  switch (n.kind) {
    case "date":
      return true;
    case "array":
      return hasRevivable(n.item, visited);
    case "optional":
      return hasRevivable(n.inner, visited);
    case "object":
      return Object.values(n.props).some((p) => hasRevivable(p, visited));
    case "ref": {
      if (visited.has(n.name)) return false;
      visited.add(n.name);
      return hasRevivable(n.resolve(), visited);
    }
    default:
      return false;
  }
}

function reviveValue(t: InferType<unknown>, value: unknown): unknown {
  const n = t._node;
  switch (n.kind) {
    case "date":
      return typeof value === "string" ? new Date(value) : value;
    case "optional":
      return value === undefined || value === null ? value : reviveValue(n.inner, value);
    case "array":
      return Array.isArray(value) ? value.map((item) => reviveValue(n.item, item)) : value;
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
      const out: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        const prop = n.props[key];
        out[key] = prop ? reviveValue(prop, v) : v;
      }
      return out;
    }
    case "ref":
      return reviveValue(n.resolve(), value);
    default:
      return value;
  }
}

function withDescription(schema: JsonSchema, description?: string): JsonSchema {
  return description ? ({ ...schema, description } as JsonSchema) : schema;
}

function expand(
  t: InferType<unknown>,
  cyclic: Set<string>,
  defs: Record<string, JsonSchema>,
  building: Set<string>,
): JsonSchema {
  const n = t._node;
  switch (n.kind) {
    case "string":
      return withDescription(n.labels ? { type: "string", enum: [...n.labels] } : { type: "string" }, t._description);
    case "number":
      return withDescription({ type: "number" }, t._description);
    case "boolean":
      return withDescription({ type: "boolean" }, t._description);
    case "date":
      return withDescription({ type: "string", format: "date-time" }, t._description);
    case "array":
      return withDescription({ type: "array", items: expand(n.item, cyclic, defs, building) }, t._description);
    case "optional":
      // optionality lives in the enclosing object's `required` list
      return withDescription(expand(n.inner, cyclic, defs, building), t._description);
    case "object": {
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, prop] of Object.entries(n.props)) {
        properties[key] = expand(prop, cyclic, defs, building);
        if (prop._node.kind !== "optional") required.push(key);
      }
      return withDescription({ type: "object", properties, required, additionalProperties: false }, t._description);
    }
    case "ref": {
      if (!cyclic.has(n.name)) {
        return withDescription(expand(n.resolve(), cyclic, defs, building), t._description);
      }
      if (!(n.name in defs) && !building.has(n.name)) {
        building.add(n.name);
        defs[n.name] = expand(n.resolve(), cyclic, defs, building);
        building.delete(n.name);
      }
      return withDescription({ $ref: `#/$defs/${n.name}` }, t._description);
    }
    case "unsupported":
      throw new NolaSchemaError(
        `NOLA3009: this type cannot be used in an intent schema: ${n.reason}`,
        Codes.SchemaUnsupported,
      );
  }
}

/** Combinator factory; emit contract 5 exposes this as `__nola.types`. */
export const inferTypes = {
  string(): InferType<string> {
    return new InferType({ kind: "string" });
  },
  number(): InferType<number> {
    return new InferType({ kind: "number" });
  },
  boolean(): InferType<boolean> {
    return new InferType({ kind: "boolean" });
  },
  date(): InferType<Date> {
    return new InferType({ kind: "date" });
  },
  enum(labels: readonly string[]): InferType<string> {
    return new InferType({ kind: "string", labels });
  },
  array<T>(item: InferType<T>): InferType<T[]> {
    return new InferType({ kind: "array", item });
  },
  object(props: Record<string, InferType<unknown>>): InferType<Record<string, unknown>> {
    return new InferType({ kind: "object", props });
  },
  optional<T>(t: InferType<T>): InferType<T | undefined> {
    return new InferType({ kind: "optional", inner: t });
  },
  ref<T = unknown>(name: string, resolve: () => InferType<T>): InferType<T> {
    return new InferType({ kind: "ref", name, resolve });
  },
  unsupported<R extends string>(reason: R): UnsupportedType<R> {
    return new InferType({ kind: "unsupported", reason }) as unknown as UnsupportedType<R>;
  },
};

/**
 * The declared return type deliberately does NOT extend InferType: an ask
 * site consuming it (directly or via a ref thunk) must be a compile-time
 * error, and the Reason literal surfaces in the TS elaboration. At runtime
 * the value IS an InferType so toJsonSchema() can throw NOLA3009.
 */
export interface UnsupportedType<Reason extends string = string> {
  readonly __nolaTypeUnsupported: Reason;
}
