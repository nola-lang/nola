/**
 * How a value prints: `json` is `JSON.stringify(value, null, 2)` exactly;
 * `js` is the same layout as a JavaScript object literal — identifier keys
 * bare, and a string that JSON would have to escape (a newline, a quote, a
 * tab…) shown raw inside backticks so multi-line text reads as text.
 */
export type ValueFormat = "json" | "js";

/** One run of pretty-printed value text, classified for colouring. */
export type JsonTokenKind = "key" | "string" | "number" | "literal" | "punct";

export interface JsonToken {
  kind: JsonTokenKind;
  text: string;
}

/** `value` printed in `format` as one string — what the copy button copies. */
export const renderValue = (value: unknown, format: ValueFormat): string =>
  jsonTokens(value, format)
    .map((t) => t.text)
    .join("");

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** A string JSON prints without a single escape — everything else goes in backticks under `js`. */
const isPlainString = (s: string): boolean => JSON.stringify(s).length === s.length + 2;

/** The raw string as a template literal: only the backtick, `${` and the backslash need escaping. */
const templateLiteral = (s: string): string => `\`${s.replace(/[\\`]|\$\{/g, (m) => `\\${m}`)}\``;

const stringToken = (s: string, format: ValueFormat): string =>
  format === "js" && !isPlainString(s) ? templateLiteral(s) : JSON.stringify(s);

const keyToken = (k: string, format: ValueFormat): string =>
  format === "js" && IDENTIFIER.test(k) ? k : JSON.stringify(k);

/**
 * Tokenize `value` the way `JSON.stringify(value, null, 2)` prints it — in
 * `json` format the tokens' text concatenates back to that output byte for
 * byte; `js` differs only in keys and escaped strings (see `ValueFormat`).
 * The value is first round-tripped through JSON so `toJSON` (Date),
 * `undefined`, NaN and friends behave exactly as they do in the plain
 * rendering; a value that stringifies to nothing yields no tokens. Adjacent
 * punctuation and whitespace fold into one `punct` token, so spans stay few.
 */
export function jsonTokens(value: unknown, format: ValueFormat = "json"): JsonToken[] {
  const text = JSON.stringify(value);
  if (text === undefined) return [];
  const out: JsonToken[] = [];
  const push = (kind: JsonTokenKind, chunk: string): void => {
    const last = out[out.length - 1];
    if (kind === "punct" && last?.kind === "punct") last.text += chunk;
    else out.push({ kind, text: chunk });
  };
  const walk = (v: unknown, depth: number): void => {
    if (v === null || typeof v === "boolean") {
      push("literal", String(v));
    } else if (typeof v === "string") {
      push("string", stringToken(v, format));
    } else if (typeof v === "number") {
      push("number", String(v));
    } else if (Array.isArray(v)) {
      walkArray(v, depth);
    } else {
      walkObject(v as Record<string, unknown>, depth);
    }
  };
  const walkArray = (items: unknown[], depth: number): void => {
    if (items.length === 0) {
      push("punct", "[]");
      return;
    }
    const inner = "  ".repeat(depth + 1);
    push("punct", `[\n${inner}`);
    items.forEach((item, i) => {
      if (i > 0) push("punct", `,\n${inner}`);
      walk(item, depth + 1);
    });
    push("punct", `\n${"  ".repeat(depth)}]`);
  };
  const walkObject = (record: Record<string, unknown>, depth: number): void => {
    const entries = Object.entries(record);
    if (entries.length === 0) {
      push("punct", "{}");
      return;
    }
    const inner = "  ".repeat(depth + 1);
    push("punct", `{\n${inner}`);
    entries.forEach(([k, item], i) => {
      if (i > 0) push("punct", `,\n${inner}`);
      push("key", keyToken(k, format));
      push("punct", ": ");
      walk(item, depth + 1);
    });
    push("punct", `\n${"  ".repeat(depth)}}`);
  };
  walk(JSON.parse(text), 0);
  return out;
}
