import { Codes } from "@nola-lang/ast";
import { NolaSchemaError, type ValidationIssue } from "@nola-lang/core";
import type { ValidationResult } from "../ask/validate.js";
import { checkConstraints } from "./constraints.js";
import { hasRevivable, resolveRef, type TypeCarrier } from "./infer-type.js";

/**
 * The path as a linked list, root = null. Materialized (`pathOf`) only when
 * an issue is recorded — the success path allocates nothing per node.
 */
type Path = { readonly key: string | number; readonly up: Path } | null;

function pathOf(p: Path): (string | number)[] {
  const out: (string | number)[] = [];
  for (let x = p; x; x = x.up) out.push(x.key);
  return out.reverse();
}

function kindOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/**
 * The ask-path validator (spec §5.2): ONE walk over the carrier that
 * type-checks every node, collects every issue, and builds the revived value
 * (date strings → Date) as it goes. With unions the matching branch decides
 * revival, which is why check and revive are one pass. The JSON-Schema
 * validator in ask/validate.ts stays as the raw-JsonSchema oracle only.
 *
 * Per-node facts that do not depend on the value — the discriminator of a
 * union, an object's required keys, whether a subtree can revive anything —
 * are computed once per node and memoized (nodes are immutable and shared
 * by every `describe` copy of a carrier). A subtree with nothing to revive
 * is returned as the input reference, not copied.
 */
export function validateCarrier(type: TypeCarrier<unknown>, value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const out = check(type, value, null, issues);
  return issues.length === 0 ? { ok: true, value: out } : { ok: false, issues };
}

type Node = TypeCarrier<unknown>["_node"];

function fail(issues: ValidationIssue[], path: Path, message: string): void {
  issues.push({ path: pathOf(path), message });
}

function check(t: TypeCarrier<unknown>, value: unknown, path: Path, issues: ValidationIssue[]): unknown {
  const n = t._node;
  switch (n.kind) {
    case "string": {
      if (typeof value !== "string") {
        fail(issues, path, `expected string, got ${kindOf(value)}`);
        return value;
      }
      if (n.labels && !n.labels.includes(value)) {
        const labels = n.labels.map((l) => JSON.stringify(l)).join(", ");
        fail(issues, path, `expected one of ${labels}, got ${JSON.stringify(value)}`);
      }
      return value;
    }
    case "date": {
      // idempotent: an already-revived (or caller-supplied) Date passes as itself
      if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) fail(issues, path, "expected a valid Date");
        return value;
      }
      if (typeof value !== "string") {
        fail(issues, path, `expected string, got ${kindOf(value)}`);
        return value;
      }
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        fail(issues, path, `expected an ISO 8601 date-time string, got ${JSON.stringify(value)}`);
        return value;
      }
      return date;
    }
    case "number":
      if (!(typeof value === "number" && Number.isFinite(value))) {
        fail(issues, path, `expected finite number, got ${kindOf(value)}`);
      }
      return value;
    case "boolean":
      if (typeof value !== "boolean") fail(issues, path, `expected boolean, got ${kindOf(value)}`);
      return value;
    case "array": {
      if (!Array.isArray(value)) {
        fail(issues, path, `expected array, got ${kindOf(value)}`);
        return value;
      }
      if (!revivable(n.item)) {
        for (let i = 0; i < value.length; i++) check(n.item, value[i], { key: i, up: path }, issues);
        return value;
      }
      const out = new Array<unknown>(value.length);
      for (let i = 0; i < value.length; i++) out[i] = check(n.item, value[i], { key: i, up: path }, issues);
      return out;
    }
    case "object": {
      if (kindOf(value) !== "object") {
        fail(issues, path, `expected object, got ${kindOf(value)}`);
        return value;
      }
      const obj = value as Record<string, unknown>;
      for (const key of requiredKeys(n)) {
        if (!(key in obj)) fail(issues, path, `missing required property '${key}'`);
      }
      const out: Record<string, unknown> | undefined = revivable(t) ? {} : undefined;
      for (const key of Object.keys(obj)) {
        const v = obj[key];
        const prop = n.props[key] ?? n.additional;
        if (!prop) {
          fail(issues, path, `unknown property '${key}'`);
          continue;
        }
        const r = check(prop, v, { key, up: path }, issues);
        if (out) out[key] = r;
      }
      return out ?? value;
    }
    case "optional":
      // absent means absent; a present null is the inner type's problem (nullable is a separate kind)
      return value === undefined ? value : check(n.inner, value, path, issues);
    case "ref":
      return check(resolveRef(n), value, path, issues);
    case "constrained": {
      // the inner check first; the keywords apply to the value it produced, and
      // only when it passed — a null/undefined from nullable/optional skips them
      const before = issues.length;
      const out = check(n.inner, value, path, issues);
      if (issues.length === before && out !== null && out !== undefined) {
        checkConstraints(out, n.constraints, (message) => fail(issues, path, message));
      }
      return out;
    }
    case "unsupported":
      throw new NolaSchemaError(
        `${Codes.SchemaUnsupported}: this type cannot be used in an intent schema: ${n.reason}`,
        Codes.SchemaUnsupported,
      );
    case "literal":
      if (value !== n.value) fail(issues, path, `expected ${JSON.stringify(n.value)}, got ${JSON.stringify(value)}`);
      return value;
    case "nullable": {
      if (value === null) return null;
      // plain-union semantics: try the inner type; on failure ONE issue with the union text
      const sub: ValidationIssue[] = [];
      const out = check(n.inner, value, path, sub);
      if (sub.length === 0) return out;
      fail(issues, path, `expected ${n.inner.toTypeText()} | null, got ${kindOf(value)}`);
      return value;
    }
    case "tuple": {
      if (!Array.isArray(value)) {
        fail(issues, path, `expected array, got ${kindOf(value)}`);
        return value;
      }
      const { min, max } = tupleBounds(n);
      if (value.length < min || value.length > max) {
        fail(issues, path, `expected ${min === max ? min : `${min} to ${max}`} items, got ${value.length}`);
        return value;
      }
      const out = new Array<unknown>(value.length);
      for (let i = 0; i < value.length; i++) {
        out[i] = check(n.items[i] as TypeCarrier<unknown>, value[i], { key: i, up: path }, issues);
      }
      return out;
    }
    case "record": {
      if (kindOf(value) !== "object") {
        fail(issues, path, `expected object, got ${kindOf(value)}`);
        return value;
      }
      const obj = value as Record<string, unknown>;
      const out: Record<string, unknown> | undefined = revivable(n.value) ? {} : undefined;
      for (const key of Object.keys(obj)) {
        const r = check(n.value, obj[key], { key, up: path }, issues);
        if (out) out[key] = r;
      }
      return out ?? value;
    }
    case "union": {
      const disc = discriminatorOf(n);
      if (disc && kindOf(value) === "object") {
        const tag = (value as Record<string, unknown>)[disc.key];
        const branch = disc.branches.get(tag as Discriminant);
        if (!branch) {
          const accepted = [...disc.branches.keys()].map((k) => JSON.stringify(k)).join(", ");
          fail(issues, { key: disc.key, up: path }, `expected one of ${accepted}, got ${JSON.stringify(tag)}`);
          return value;
        }
        return check(branch, value, path, issues);
      }
      for (const m of n.members) {
        const sub: ValidationIssue[] = [];
        const out = check(m, value, path, sub);
        if (sub.length === 0) return out;
      }
      fail(issues, path, `expected ${t.toTypeText()}, got ${kindOf(value)}`);
      return value;
    }
  }
}

// ---- per-node memos (value-independent facts, computed once per node) ----

const requiredMemo = new WeakMap<Node, readonly string[]>();
function requiredKeys(n: Extract<Node, { kind: "object" }>): readonly string[] {
  let keys = requiredMemo.get(n);
  if (!keys) {
    keys = Object.entries(n.props)
      .filter(([, p]) => p._node.kind !== "optional")
      .map(([key]) => key);
    requiredMemo.set(n, keys);
  }
  return keys;
}

const boundsMemo = new WeakMap<Node, { min: number; max: number }>();
function tupleBounds(n: Extract<Node, { kind: "tuple" }>): { min: number; max: number } {
  let b = boundsMemo.get(n);
  if (!b) {
    b = { min: n.items.filter((i) => i._node.kind !== "optional").length, max: n.items.length };
    boundsMemo.set(n, b);
  }
  return b;
}

/** Any date leaf reachable from this carrier? Cyclic refs terminate by visiting each name once. */
const revivableMemo = new WeakMap<Node, boolean>();
function revivable(t: TypeCarrier<unknown>): boolean {
  const n = t._node;
  let r = revivableMemo.get(n);
  if (r === undefined) {
    r = hasRevivable(t, new Set());
    revivableMemo.set(n, r);
  }
  return r;
}

type Discriminant = string | number | boolean;
type Discriminator = { key: string; branches: Map<Discriminant, TypeCarrier<unknown>> };

const discriminatorMemo = new WeakMap<Node, Discriminator | null>();
function discriminatorOf(n: Extract<Node, { kind: "union" }>): Discriminator | null {
  let d = discriminatorMemo.get(n);
  if (d === undefined) {
    d = discriminator(n.members) ?? null;
    discriminatorMemo.set(n, d);
  }
  return d;
}

/**
 * A union is DISCRIMINATED when every member is an object sharing a key whose
 * node is a literal or a string enum with pairwise-disjoint values (spec
 * §5.2). The first such key wins; refs are resolved to find the objects.
 */
function discriminator(members: TypeCarrier<unknown>[]): Discriminator | undefined {
  const objects = members.map((m) => (m._node.kind === "ref" ? resolveRef(m._node) : m));
  const props = objects.map((o) => (o._node.kind === "object" ? o._node.props : undefined));
  if (props.some((p) => p === undefined)) return undefined;
  const first = props[0] as Record<string, TypeCarrier<unknown>>;
  for (const key of Object.keys(first)) {
    const branches = new Map<Discriminant, TypeCarrier<unknown>>();
    let ok = true;
    for (const [i, o] of objects.entries()) {
      const p = (props[i] as Record<string, TypeCarrier<unknown>>)[key]?._node;
      const values: Discriminant[] | undefined =
        p?.kind === "literal" ? [p.value] : p?.kind === "string" && p.labels ? [...p.labels] : undefined;
      if (!values || values.some((v) => branches.has(v))) {
        ok = false;
        break;
      }
      for (const v of values) branches.set(v, o);
    }
    if (ok) return { key, branches };
  }
  return undefined;
}
