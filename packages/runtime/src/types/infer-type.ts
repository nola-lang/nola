import { Codes } from "@nola-lang/ast";
import type { JsonSchema } from "@nola-lang/core";
import { formatIssues, NolaSchemaError, NolaValidationError, redactSecrets } from "@nola-lang/core";
import type { ValidationResult } from "../ask/validate.js";
import { type Constraints, mergeConstraintKeywords } from "./constraints.js";
import { toDialect } from "./json-schema-dialects.js";
import type {
  NolaStandardProps,
  StandardJSONSchemaV1,
  StandardJSONSchemaV1Options,
  StandardSchemaV1,
} from "./standard-schema.js";
import { validateCarrier } from "./validate-carrier.js";

export const INFER_TYPE_BRAND = "nola.infertype" as const;

/**
 * The PUBLIC type of a type value (emit 14): `export const User = … as
 * InferType<User>` is what a user sees on `User.`, so this interface is the
 * whole documented surface — four members, nothing else. The carrier class
 * behind it (`TypeCarrier`) keeps the extractor-path machinery (brand, node,
 * describe/refName/revive/toTypeText, …) and is not exported from the package
 * index; the editor's suggestion widget must never list those.
 */
export interface InferType<T = unknown> extends StandardSchemaV1<unknown, T>, StandardJSONSchemaV1<unknown, T> {
  /** The derived JSON Schema (draft 2020-12 shape); cycles serialize as root $defs + $ref. */
  toJsonSchema(): JsonSchema;
  /** Validate against the derived schema; on success the value is revived exactly as an ask result is. */
  validate(value: unknown): ValidationResult<T>;
  /** validate() or throw NolaValidationError (NOLA3016). */
  parse(value: unknown): T;
  /**
   * Standard Schema v1 + Standard JSON Schema (https://standardschema.dev):
   * `validate` for any consumer of the spec, `jsonSchema.input/output({ target })`
   * for draft-2020-12, draft-07 and openapi-3.0 (anything else is NOLA3017).
   */
  readonly "~standard": NolaStandardProps<T>;
}

/**
 * A ref resolver returns the target type — or, in Turbopack inline mode
 * (emit 14), the hoisted accessor FUNCTION that builds it; `resolveRef`
 * unwraps either. Generated code reads it only at schema time, never during
 * module evaluation (cycle safety across `.tsi` value imports).
 */
type RefResolver = () => InferType<unknown> | (() => InferType<unknown>);

type TypeNode =
  | { kind: "string"; labels?: readonly string[] }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "date" }
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "array"; item: TypeCarrier<unknown> }
  | { kind: "tuple"; items: TypeCarrier<unknown>[] }
  | { kind: "object"; props: Record<string, TypeCarrier<unknown>>; additional?: TypeCarrier<unknown> }
  | { kind: "record"; value: TypeCarrier<unknown> }
  | { kind: "optional"; inner: TypeCarrier<unknown> }
  | { kind: "nullable"; inner: TypeCarrier<unknown> }
  | { kind: "union"; members: TypeCarrier<unknown>[] }
  | { kind: "ref"; name: string; resolve: RefResolver }
  | { kind: "constrained"; inner: TypeCarrier<unknown>; constraints: Constraints }
  // decision types (spec 2026-09-18): the answer shapes of a decision question
  // `numeric`: the labels (by text) written as number literals — criteria keyed by their text, `choice` answered as the number
  | { kind: "choice"; criteria: Record<string, string | null>; numeric?: readonly string[] }
  | { kind: "scale"; levels: readonly string[] }
  | { kind: "prob"; criteria?: { true: string; false: string } }
  | { kind: "unsupported"; reason: string };

/**
 * Narrow a public InferType to its carrier. Generated code is the only
 * constructor of type values, so every InferType IS a carrier; anything else
 * (a foreign Standard Schema, say) cannot take part in a Nola schema.
 */
export function asCarrier(t: InferType<unknown>): TypeCarrier<unknown> {
  if (TypeCarrier.is(t)) return t;
  throw new NolaSchemaError(
    `${Codes.SchemaUnsupported}: this type cannot be used in an intent schema: not a Nola type value`,
    Codes.SchemaUnsupported,
  );
}

/** Brand check typed on the PUBLIC interface — narrows unions such as `JsonSchema | InferType`. */
export function isInferType(v: unknown): v is InferType<unknown> {
  return TypeCarrier.is(v);
}

export function resolveRef(n: { resolve: RefResolver }): TypeCarrier<unknown> {
  const r = n.resolve();
  return asCarrier(typeof r === "function" ? r() : r);
}

/**
 * Schema carrier for emit contract 5 (spec §5a). Pure and immutable; the
 * provider/validator/fingerprint seams keep consuming JsonSchema — this class
 * only changes the carrier. toJsonSchema() inlines every non-cyclic ref so the
 * output is canonically identical to the emit-4 inline derivation; only refs
 * that participate in a cycle serialize as root $defs + $ref pointers.
 *
 * INTERNAL: `__nola.types` builds these and the runtime's extractor path reads
 * them; users only ever hold the `InferType` interface (see above).
 */
export class TypeCarrier<T = unknown> implements InferType<T> {
  static is(v: unknown): v is TypeCarrier<unknown> {
    return (
      typeof v === "object" && v !== null && (v as { __nolaTypeBrand?: unknown }).__nolaTypeBrand === INFER_TYPE_BRAND
    );
  }

  readonly __nolaTypeBrand = INFER_TYPE_BRAND;

  constructor(
    private readonly node: TypeNode,
    private readonly description?: string,
  ) {}

  describe(text: string): TypeCarrier<T> {
    return new TypeCarrier<T>(this.node, text);
  }

  /** Emit 16: JSDoc constraint keywords; the schema carries them, validation enforces them. */
  constrain(constraints: Constraints): TypeCarrier<T> {
    return new TypeCarrier<T>({ kind: "constrained", inner: this, constraints }, this.description);
  }

  /**
   * The named reference at this type's root (`<Ticket>`), bare of a
   * view's `moduleId#` qualifier; undefined for anonymous shapes. Display
   * only — never identity.
   */
  refName(): string | undefined {
    if (this.node.kind !== "ref") return undefined;
    const hash = this.node.name.lastIndexOf("#");
    return hash === -1 ? this.node.name : this.node.name.slice(hash + 1);
  }

  /** Memoized: the carrier is immutable, so the schema is computed once per instance. */
  private schemaMemo: JsonSchema | undefined;

  toJsonSchema(): JsonSchema {
    if (this.schemaMemo) return this.schemaMemo;
    const cyclic = new Set<string>();
    findCycles(this, new Set(), new Set(), cyclic);
    const defs: Record<string, JsonSchema> = {};
    const root = expand(this, cyclic, defs, new Set());
    this.schemaMemo = Object.keys(defs).length > 0 ? ({ ...root, $defs: defs } as JsonSchema) : root;
    return this.schemaMemo;
  }

  toString(): string {
    return JSON.stringify(this.toJsonSchema(), null, 2);
  }

  toNativeType(): string {
    const n = this._node;
    switch (n.kind) {
      case "ref":
        return resolveRef(n).toNativeType();
      case "literal":
        return typeof n.value;
      case "tuple":
        return "array";
      case "record":
        return "object";
      case "nullable":
      case "constrained":
        return n.inner.toNativeType();
      case "choice":
      case "scale":
        return "object";
      case "prob":
        return "number";
      default:
        return n.kind;
    }
  }

  /**
   * The type as TypeScript source text — what the author wrote after the
   * extractor, reconstructed from the carrier: `"quote" | "order"`,
   * `{ id: string; note?: string }`, `Ticket` (a ref by name, never
   * expanded, view qualifier stripped). Display only — never identity.
   */
  toTypeText(): string {
    const n = this.node;
    switch (n.kind) {
      case "string":
        return n.labels ? n.labels.map((l) => JSON.stringify(l)).join(" | ") : "string";
      case "number":
      case "boolean":
        return n.kind;
      case "date":
        return "Date";
      case "array": {
        const item = n.item.toTypeText();
        return n.item._node.kind === "string" && n.item._node.labels ? `(${item})[]` : `${item}[]`;
      }
      case "optional":
        return `${n.inner.toTypeText()} | undefined`;
      case "object": {
        const props = Object.entries(n.props).map(([key, prop]) =>
          prop._node.kind === "optional" ? `${key}?: ${prop._node.inner.toTypeText()}` : `${key}: ${prop.toTypeText()}`,
        );
        return props.length === 0 ? "{}" : `{ ${props.join("; ")} }`;
      }
      case "literal":
        return JSON.stringify(n.value);
      case "tuple":
        return `[${n.items
          .map((i) => (i._node.kind === "optional" ? `${i._node.inner.toTypeText()}?` : i.toTypeText()))
          .join(", ")}]`;
      case "record":
        return `Record<string, ${n.value.toTypeText()}>`;
      case "nullable":
        return `${n.inner.toTypeText()} | null`;
      case "union":
        return n.members.map((m) => m.toTypeText()).join(" | ");
      case "ref":
        return this.refName() as string;
      case "constrained":
        return n.inner.toTypeText();
      case "choice": {
        const entries = Object.entries(n.criteria);
        if (entries.every(([, d]) => d === null)) {
          return `Choice<${entries.map(([l]) => (n.numeric?.includes(l) ? l : JSON.stringify(l))).join(" | ")}>`;
        }
        return `Choice<{ ${entries.map(([l, d]) => `${l}: ${d === null ? "null" : JSON.stringify(d)}`).join("; ")} }>`;
      }
      case "scale":
        return `Scale<[${n.levels.map((l) => JSON.stringify(l)).join(", ")}]>`;
      case "prob":
        return n.criteria
          ? `Prob<{ true: ${JSON.stringify(n.criteria.true)}; false: ${JSON.stringify(n.criteria.false)} }>`
          : "Prob";
      case "unsupported":
        return "never";
    }
  }

  /**
   * Post-validation wire→value transform: date leaves become Date instances.
   * Identity (same reference) when no date is reachable in the type. The walk
   * follows the (finite, JSON-derived) VALUE, so cyclic ref types terminate.
   */
  revive(value: unknown): unknown {
    return hasRevivable(this, new Set()) ? reviveValue(this, value) : value;
  }

  validate(value: unknown): ValidationResult<T> {
    return validateCarrier(this, value) as ValidationResult<T>;
  }

  parse(value: unknown): T {
    const r = this.validate(value);
    if (r.ok) return r.value;
    throw new NolaValidationError(
      redactSecrets(`${Codes.ValidationFailed}: value does not match ${this.toTypeText()}: ${formatIssues(r.issues)}`),
      Codes.ValidationFailed,
      r.issues,
    );
  }

  /** One converted document per dialect; the 2020-12 entry is `toJsonSchema()` itself. */
  private readonly dialectMemo = new Map<string, Record<string, unknown>>();

  /**
   * Input and output are the SAME document: the only place the accepted and
   * returned values differ is `Date` (an ISO string in, an instance out), and
   * JSON Schema has no vocabulary for the instance — so the wire shape is the
   * honest answer on both sides.
   */
  private jsonSchemaFor(options: StandardJSONSchemaV1Options | undefined): Record<string, unknown> {
    const target = options?.target ?? "draft-2020-12";
    const memo = this.dialectMemo.get(target);
    if (memo) return memo;
    const doc = toDialect(this.toJsonSchema(), target);
    this.dialectMemo.set(target, doc);
    return doc;
  }

  get "~standard"(): NolaStandardProps<T> {
    return {
      version: 1,
      vendor: "nola",
      validate: (value: unknown) => {
        const r = this.validate(value);
        return r.ok ? { value: r.value } : { issues: r.issues.map((i) => ({ message: i.message, path: [...i.path] })) };
      },
      jsonSchema: {
        input: (options) => this.jsonSchemaFor(options),
        output: (options) => this.jsonSchemaFor(options),
      },
    };
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
function findCycles(t: TypeCarrier<unknown>, stack: Set<string>, visited: Set<string>, cyclic: Set<string>): void {
  const n = t._node;
  switch (n.kind) {
    case "array":
      findCycles(n.item, stack, visited, cyclic);
      return;
    case "optional":
    case "nullable":
    case "constrained":
      findCycles(n.inner, stack, visited, cyclic);
      return;
    case "record":
      findCycles(n.value, stack, visited, cyclic);
      return;
    case "tuple":
      for (const i of n.items) findCycles(i, stack, visited, cyclic);
      return;
    case "union":
      for (const m of n.members) findCycles(m, stack, visited, cyclic);
      return;
    case "object":
      for (const p of Object.values(n.props)) findCycles(p, stack, visited, cyclic);
      if (n.additional) findCycles(n.additional, stack, visited, cyclic);
      return;
    case "ref": {
      if (stack.has(n.name)) {
        cyclic.add(n.name);
        return;
      }
      if (visited.has(n.name)) return;
      visited.add(n.name);
      stack.add(n.name);
      findCycles(resolveRef(n), stack, visited, cyclic);
      stack.delete(n.name);
      return;
    }
    default:
      // scalars and unsupported carry no children
      return;
  }
}

/** Any date leaf reachable? Visits each ref name once, so cycles terminate. Shared with the validator. */
export function hasRevivable(t: TypeCarrier<unknown>, visited: Set<string>): boolean {
  const n = t._node;
  switch (n.kind) {
    case "date":
      return true;
    case "array":
      return hasRevivable(n.item, visited);
    case "optional":
    case "nullable":
    case "constrained":
      return hasRevivable(n.inner, visited);
    case "record":
      return hasRevivable(n.value, visited);
    case "tuple":
      return n.items.some((i) => hasRevivable(i, visited));
    case "union":
      return n.members.some((m) => hasRevivable(m, visited));
    case "object":
      return (
        Object.values(n.props).some((p) => hasRevivable(p, visited)) ||
        (n.additional !== undefined && hasRevivable(n.additional, visited))
      );
    case "ref": {
      if (visited.has(n.name)) return false;
      visited.add(n.name);
      return hasRevivable(resolveRef(n), visited);
    }
    case "scale":
      // the runtime fills `levels` into the answer, so an enclosing object is copied
      return true;
    default:
      return false;
  }
}

function reviveValue(t: TypeCarrier<unknown>, value: unknown): unknown {
  const n = t._node;
  switch (n.kind) {
    case "date":
      return typeof value === "string" ? new Date(value) : value;
    case "optional":
    case "nullable":
      return value === undefined || value === null ? value : reviveValue(n.inner, value);
    case "array":
      return Array.isArray(value) ? value.map((item) => reviveValue(n.item, item)) : value;
    case "tuple":
      return Array.isArray(value)
        ? value.map((item, i) => (n.items[i] ? reviveValue(n.items[i] as TypeCarrier<unknown>, item) : item))
        : value;
    case "record": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
      const out: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) out[key] = reviveValue(n.value, v);
      return out;
    }
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
      const out: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        const prop = n.props[key] ?? n.additional;
        out[key] = prop ? reviveValue(prop, v) : v;
      }
      return out;
    }
    case "ref":
      return reviveValue(resolveRef(n), value);
    case "constrained":
      return reviveValue(n.inner, value);
    case "scale":
      return typeof value === "object" && value !== null && !Array.isArray(value)
        ? { ...value, levels: [...n.levels] }
        : value;
    default:
      return value;
  }
}

function withDescription(schema: JsonSchema, description?: string): JsonSchema {
  return description ? ({ ...schema, description } as JsonSchema) : schema;
}

/** A probability on the wire: the unit interval. */
const UNIT: JsonSchema = { type: "number", minimum: 0, maximum: 1 };

function expand(
  t: TypeCarrier<unknown>,
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
      return withDescription(
        {
          type: "object",
          properties,
          required,
          additionalProperties: n.additional ? expand(n.additional, cyclic, defs, building) : false,
        },
        t._description,
      );
    }
    case "literal":
      return withDescription({ const: n.value }, t._description);
    case "tuple": {
      const prefixItems = n.items.map((i) =>
        expand(i._node.kind === "optional" ? i._node.inner : i, cyclic, defs, building),
      );
      const minItems = n.items.filter((i) => i._node.kind !== "optional").length;
      return withDescription(
        { type: "array", prefixItems, items: false, minItems, maxItems: n.items.length },
        t._description,
      );
    }
    case "record":
      return withDescription(
        { type: "object", additionalProperties: expand(n.value, cyclic, defs, building) },
        t._description,
      );
    case "nullable":
      return withDescription(
        { anyOf: [expand(n.inner, cyclic, defs, building), { type: "null" }] },
        t._description,
      );
    case "union":
      return withDescription({ anyOf: n.members.map((m) => expand(m, cyclic, defs, building)) }, t._description);
    case "ref": {
      if (!cyclic.has(n.name)) {
        return withDescription(expand(resolveRef(n), cyclic, defs, building), t._description);
      }
      if (!(n.name in defs) && !building.has(n.name)) {
        building.add(n.name);
        defs[n.name] = expand(resolveRef(n), cyclic, defs, building);
        building.delete(n.name);
      }
      return withDescription({ $ref: `#/$defs/${n.name}` }, t._description);
    }
    case "constrained":
      return withDescription(
        mergeConstraintKeywords(expand(n.inner, cyclic, defs, building), n.constraints),
        t._description,
      );
    case "prob":
      return withDescription(
        {
          type: "number",
          minimum: 0,
          maximum: 1,
          "x-nola-decision": n.criteria ? { kind: "prob", criteria: n.criteria } : { kind: "prob" },
        },
        t._description,
      );
    case "choice": {
      const labels = Object.keys(n.criteria);
      const numeric = n.numeric ?? [];
      const perLabel: Record<string, JsonSchema> = {};
      for (const label of labels) perLabel[label] = UNIT;
      // the chosen label in its own kind: all strings, all numbers, or a union of consts when mixed
      const choice: JsonSchema =
        numeric.length === 0
          ? { type: "string", enum: labels }
          : numeric.length === labels.length
            ? { type: "number", enum: labels.map(Number) }
            : { anyOf: labels.map((l) => ({ const: numeric.includes(l) ? Number(l) : l })) };
      return withDescription(
        {
          type: "object",
          properties: {
            choice,
            probabilities: { type: "object", properties: perLabel, required: labels, additionalProperties: false },
            confidence: UNIT,
          },
          required: ["choice", "probabilities"],
          additionalProperties: false,
          "x-nola-decision":
            numeric.length > 0 ? { kind: "choice", criteria: n.criteria, numeric } : { kind: "choice", criteria: n.criteria },
        },
        t._description,
      );
    }
    case "scale": {
      const count = n.levels.length;
      return withDescription(
        {
          type: "object",
          properties: {
            score: { type: "number", minimum: 0, maximum: count - 1 },
            probabilities: { type: "array", items: UNIT, minItems: count, maxItems: count },
            levels: {
              type: "array",
              prefixItems: n.levels.map((l) => ({ const: l })),
              items: false,
              minItems: count,
              maxItems: count,
            },
            confidence: UNIT,
          },
          required: ["score", "probabilities"],
          additionalProperties: false,
          "x-nola-decision": { kind: "scale", levels: n.levels },
        },
        t._description,
      );
    }
    case "unsupported":
      throw new NolaSchemaError(
        `NOLA3009: this type cannot be used in an intent schema: ${n.reason}`,
        Codes.SchemaUnsupported,
      );
  }
}

/**
 * Combinator factory; emit contract 5 exposes this as `__nola.types`. Inputs
 * are the public InferType (the emitted accessors are annotated with it);
 * outputs are carriers, so emitted `.describe("…")` chains type-check.
 */
export const inferTypes = {
  string(): TypeCarrier<string> {
    return new TypeCarrier({ kind: "string" });
  },
  number(): TypeCarrier<number> {
    return new TypeCarrier({ kind: "number" });
  },
  boolean(): TypeCarrier<boolean> {
    return new TypeCarrier({ kind: "boolean" });
  },
  date(): TypeCarrier<Date> {
    return new TypeCarrier({ kind: "date" });
  },
  enum(labels: readonly string[]): TypeCarrier<string> {
    return new TypeCarrier({ kind: "string", labels });
  },
  array<T>(item: InferType<T>): TypeCarrier<T[]> {
    return new TypeCarrier({ kind: "array", item: asCarrier(item) });
  },
  object(
    props: Record<string, InferType<unknown>>,
    options?: { additional?: InferType<unknown> },
  ): TypeCarrier<Record<string, unknown>> {
    const carriers: Record<string, TypeCarrier<unknown>> = {};
    for (const [key, prop] of Object.entries(props)) carriers[key] = asCarrier(prop);
    // the key is absent (not undefined) without an index signature, so old objects stay structurally identical
    return new TypeCarrier(
      options?.additional
        ? { kind: "object", props: carriers, additional: asCarrier(options.additional) }
        : { kind: "object", props: carriers },
    );
  },
  optional<T>(t: InferType<T>): TypeCarrier<T | undefined> {
    return new TypeCarrier({ kind: "optional", inner: asCarrier(t) });
  },
  literal(value: string | number | boolean): TypeCarrier<string | number | boolean> {
    return new TypeCarrier({ kind: "literal", value });
  },
  tuple(items: InferType<unknown>[]): TypeCarrier<unknown[]> {
    return new TypeCarrier({ kind: "tuple", items: items.map(asCarrier) });
  },
  record<T>(value: InferType<T>): TypeCarrier<Record<string, T>> {
    return new TypeCarrier({ kind: "record", value: asCarrier(value) });
  },
  nullable<T>(t: InferType<T>): TypeCarrier<T | null> {
    return new TypeCarrier({ kind: "nullable", inner: asCarrier(t) });
  },
  union(members: InferType<unknown>[]): TypeCarrier<unknown> {
    return new TypeCarrier({ kind: "union", members: members.map(asCarrier) });
  },
  choice(
    criteria: Record<string, string | null>,
    options?: { readonly numeric?: readonly string[] },
  ): TypeCarrier<Record<string, unknown>> {
    const numeric = options?.numeric ?? [];
    return new TypeCarrier(
      numeric.length > 0
        ? { kind: "choice", criteria: { ...criteria }, numeric: [...numeric] }
        : { kind: "choice", criteria: { ...criteria } },
    );
  },
  scale(levels: readonly string[]): TypeCarrier<Record<string, unknown>> {
    return new TypeCarrier({ kind: "scale", levels: [...levels] });
  },
  prob(criteria?: { true: string; false: string }): TypeCarrier<number> {
    return new TypeCarrier(criteria ? { kind: "prob", criteria: { ...criteria } } : { kind: "prob" });
  },
  ref<T = unknown>(name: string, resolve: () => InferType<T> | (() => InferType<T>)): TypeCarrier<T> {
    return new TypeCarrier({ kind: "ref", name, resolve: resolve as RefResolver });
  },
  unsupported<R extends string>(reason: R): UnsupportedType<R> {
    return new TypeCarrier({ kind: "unsupported", reason }) as unknown as UnsupportedType<R>;
  },
};

/**
 * The declared return type deliberately does NOT extend InferType: an ask
 * site consuming it (directly or via a ref thunk) must be a compile-time
 * error, and the Reason literal surfaces in the TS elaboration. At runtime
 * the value IS a carrier so toJsonSchema() can throw NOLA3009.
 */
export interface UnsupportedType<Reason extends string = string> {
  readonly __nolaTypeUnsupported: Reason;
}

/**
 * The type of an exported type's VALUE (emit 15): `export const X =
 * __nola_type_X() as unknown as TypeValueOf<typeof __nola_type_X, X>`. The
 * compiler's phase 1 cannot know whether X derives, so the cast reads the
 * accessor's return type: an UnsupportedType accessor (filled in by the
 * checker pass) keeps the use-site elaboration, everything else is
 * `InferType<X>` — which is also what hover shows.
 */
export type TypeValueOf<Accessor, T> = Accessor extends () => UnsupportedType<infer R>
  ? UnsupportedType<R>
  : InferType<T>;
