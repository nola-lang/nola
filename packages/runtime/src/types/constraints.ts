import type { JsonSchema } from "@nola-lang/core";

/**
 * JSDoc constraints (emit 16, spec 2026-09-15): the JSON Schema validation
 * vocabulary a `@format` / `@minimum` / `@minItems` … tag on a member turns
 * into. The keys ARE the keywords, so `mergeConstraintKeywords` is a spread
 * and the model reads them verbatim in the schema.
 */
export interface Constraints {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: Format;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  integer?: true;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: true;
}

export const FORMATS = ["date-time", "date", "time", "email", "uri", "uuid", "ipv4", "ipv6", "hostname"] as const;
export type Format = (typeof FORMATS)[number];

/**
 * Put the keywords on the inner schema: into a nullable's non-null branch
 * (`anyOf: [X, null]`), `integer` replacing `type: "number"`, and otherwise
 * as siblings — including beside a cyclic `$ref` (legal in 2020-12; the
 * dialect converter wraps it in `allOf` for the older targets).
 */
export function mergeConstraintKeywords(schema: JsonSchema, c: Constraints): JsonSchema {
  if ("anyOf" in schema && schema.anyOf.length === 2 && isNull(schema.anyOf[1])) {
    return { ...schema, anyOf: [mergeConstraintKeywords(schema.anyOf[0] as JsonSchema, c), schema.anyOf[1] as JsonSchema] };
  }
  const { integer, ...keywords } = c;
  const merged = { ...schema, ...keywords } as JsonSchema;
  return integer && "type" in merged && merged.type === "number" ? ({ ...merged, type: "integer" } as JsonSchema) : merged;
}

function isNull(s: JsonSchema | undefined): boolean {
  return s !== undefined && "type" in s && s.type === "null";
}

/**
 * Enforce the keywords on a value the inner check already accepted; one
 * `fail(message)` per violated keyword so the all-errors list carries each.
 * Lengths are UTF-16 code units (JavaScript `length`); `multipleOf` is
 * decided on decimal-scaled integers so `0.3 / 0.1` is exact; `uniqueItems`
 * compares canonical JSON.
 */
export function checkConstraints(value: unknown, c: Constraints, fail: (message: string) => void): void {
  if (typeof value === "string") {
    if (c.minLength !== undefined && value.length < c.minLength) {
      fail(`expected at least ${c.minLength} ${plural(c.minLength, "character")}, got ${value.length}`);
    }
    if (c.maxLength !== undefined && value.length > c.maxLength) {
      fail(`expected at most ${c.maxLength} ${plural(c.maxLength, "character")}, got ${value.length}`);
    }
    if (c.pattern !== undefined && !new RegExp(c.pattern).test(value)) {
      fail(`expected a string matching ${c.pattern}, got ${JSON.stringify(value)}`);
    }
    if (c.format !== undefined && !FORMAT_CHECKS[c.format](value)) {
      fail(`expected a valid ${c.format}, got ${JSON.stringify(value)}`);
    }
    return;
  }
  if (typeof value === "number") {
    if (c.integer && !Number.isInteger(value)) fail(`expected an integer, got ${value}`);
    if (c.minimum !== undefined && value < c.minimum) fail(`expected a number ≥ ${c.minimum}, got ${value}`);
    if (c.maximum !== undefined && value > c.maximum) fail(`expected a number ≤ ${c.maximum}, got ${value}`);
    if (c.exclusiveMinimum !== undefined && value <= c.exclusiveMinimum) {
      fail(`expected a number > ${c.exclusiveMinimum}, got ${value}`);
    }
    if (c.exclusiveMaximum !== undefined && value >= c.exclusiveMaximum) {
      fail(`expected a number < ${c.exclusiveMaximum}, got ${value}`);
    }
    if (c.multipleOf !== undefined && !isMultiple(value, c.multipleOf)) {
      fail(`expected a multiple of ${c.multipleOf}, got ${value}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (c.minItems !== undefined && value.length < c.minItems) {
      fail(`expected at least ${c.minItems} ${plural(c.minItems, "item")}, got ${value.length}`);
    }
    if (c.maxItems !== undefined && value.length > c.maxItems) {
      fail(`expected at most ${c.maxItems} ${plural(c.maxItems, "item")}, got ${value.length}`);
    }
    if (c.uniqueItems) {
      const seen = new Set<string>();
      for (let i = 0; i < value.length; i++) {
        const key = canonical(value[i]);
        if (seen.has(key)) {
          fail(`expected unique items, found a duplicate at index ${i}`);
          break;
        }
        seen.add(key);
      }
    }
  }
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

/** `value / step` is a whole number, decided on integers after scaling both by the longer decimal fraction. */
function isMultiple(value: number, step: number): boolean {
  const scale = 10 ** Math.max(decimals(value), decimals(step));
  const v = Math.round(value * scale);
  const s = Math.round(step * scale);
  return s !== 0 && v % s === 0;
}

function decimals(n: number): number {
  const text = String(n);
  const exp = /e-(\d+)$/i.exec(text);
  const fraction = text.split(".")[1]?.length ?? 0;
  return exp ? Number(exp[1]) + fraction : fraction;
}

/** Sorted-key JSON, so `{a:1,b:2}` and `{b:2,a:1}` are one item. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "undefined";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(",")}}`;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

function isCalendarDate(s: string): boolean {
  const m = DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function isIpv6(s: string): boolean {
  if (!/^[0-9a-f:.]+$/i.test(s) || s.length < 2) return false;
  const parts = s.split("::");
  if (parts.length > 2) return false;
  const groups = (p: string): string[] => (p === "" ? [] : p.split(":"));
  const all = [...groups(parts[0] as string), ...(parts.length === 2 ? groups(parts[1] as string) : [])];
  // an embedded IPv4 tail counts as two groups
  const last = all[all.length - 1];
  const hasIpv4 = last?.includes(".") === true;
  if (hasIpv4 && !IPV4.test(last as string)) return false;
  const hexGroups = hasIpv4 ? all.slice(0, -1) : all;
  if (!hexGroups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return false;
  const count = hexGroups.length + (hasIpv4 ? 2 : 0);
  return parts.length === 2 ? count < 8 : count === 8;
}

const FORMAT_CHECKS: Record<Format, (s: string) => boolean> = {
  "date-time": (s) => DATE_TIME.test(s) && Number.isFinite(Date.parse(s)),
  date: isCalendarDate,
  time: (s) => TIME.test(s),
  email: (s) => EMAIL.test(s),
  uri: (s) => /^[a-z][a-z0-9+.-]*:/i.test(s) && URL.canParse(s),
  uuid: (s) => UUID.test(s),
  ipv4: (s) => IPV4.test(s),
  ipv6: isIpv6,
  hostname: (s) => HOSTNAME.test(s),
};
