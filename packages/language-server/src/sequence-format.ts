import type { SequenceShape, ShapeSpan } from "@nola-lang/compiler";

/** A formatter's change over the original text, TypeScript's shape. */
export interface TextChange {
  span: { start: number; length: number };
  newText: string;
}

export interface LayoutOptions {
  tabSize: number;
  insertSpaces: boolean;
}

/**
 * Lays the ask sequences of a .tsi out (ask-sequence spec §3.12). TypeScript's
 * formatter reads `` ask `x` [a] `y`: T `` as tagged templates and an index:
 * it deletes the spaces between the parts and sets a part on its own line at
 * the statement's column. So inside a sequence's extent TypeScript's changes
 * are kept only where its reading is right — inside a text, a value or a
 * list entry — and the sequence's own layout is this one: one space between
 * the tokens on a line (the head, the parts, a list's `[`, entries and `]`),
 * the colon and `<T>` glued to the last part and one space after the colon,
 * nothing before a comma and one space after it; a token that starts a line
 * keeps its line break (and whatever stood before it, a blank line or
 * trailing spaces) and is indented from the line the construct starts on —
 * a part, a list's `]` or the type one level in, a list's entry two. A gap
 * that holds anything but whitespace (a comment) is left as written.
 *
 * `changes` are TypeScript's over `text`; the result is the ones kept plus
 * the layout's, every one inside `range`, none overlapping.
 */
export function layoutSequences(
  text: string,
  shapes: readonly SequenceShape[],
  changes: readonly TextChange[],
  range: ShapeSpan,
  options: LayoutOptions,
): TextChange[] {
  const kept = changes.filter((change) => !shapes.some((shape) => dropsChange(shape, change)));
  const unit = options.insertSpaces ? " ".repeat(options.tabSize) : "\t";
  const out: TextChange[] = [...kept];
  for (const shape of shapes) {
    if (shape.end < range.start || shape.start > range.end) continue;
    const base = baseIndentation(text, shape.start, kept);
    const indent = (level: number) => base + unit.repeat(level);
    for (const edit of shapeEdits(text, shape, indent)) {
      const end = edit.span.start + edit.span.length;
      if (end < range.start || edit.span.start > range.end) continue;
      out.push(edit);
    }
  }
  return out;
}

/** TypeScript's change is dropped when it touches the shape outside a text, a value or a list entry. */
function dropsChange(shape: SequenceShape, change: TextChange): boolean {
  const start = change.span.start;
  const end = start + change.span.length;
  const touches = change.span.length === 0 ? start > shape.start && start < shape.end : start < shape.end && shape.start < end;
  if (!touches) return false;
  for (const part of shape.parts) {
    const inner = part.kind === "list" ? (part.entries ?? []) : [part];
    for (const span of inner) {
      const inside = change.span.length === 0 ? start > span.start && start < span.end : start > span.start && end < span.end;
      if (inside) return false;
    }
  }
  return true;
}

/** The leading whitespace of the line `offset` is on, as the kept changes leave it. */
function baseIndentation(text: string, offset: number, kept: readonly TextChange[]): string {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const leading = /^[ \t]*/.exec(text.slice(lineStart, offset))?.[0] ?? "";
  for (const change of kept) {
    if (change.span.start !== lineStart || change.span.start + change.span.length > lineStart + leading.length) continue;
    const last = change.newText.slice(change.newText.lastIndexOf("\n") + 1);
    if (/^[ \t]*$/.test(last)) return last + leading.slice(change.span.length);
  }
  return leading;
}

interface Token extends ShapeSpan {
  kind: "head" | "part" | "colon" | "type" | "angle";
}

function* shapeEdits(text: string, shape: SequenceShape, indent: (level: number) => string): Generator<TextChange> {
  const tokens: Token[] = shape.head.map((t) => ({ ...t, kind: "head" }));
  for (const part of shape.parts) tokens.push({ start: part.start, end: part.end, kind: "part" });
  if (shape.type?.kind === "colon") {
    tokens.push({ start: shape.type.colon, end: shape.type.colon + 1, kind: "colon" }, { ...shape.type.text, kind: "type" });
  } else if (shape.type) {
    tokens.push({ start: shape.type.start, end: shape.type.end, kind: "angle" });
  }
  for (let i = 1; i < tokens.length; i++) {
    const before = tokens[i - 1];
    const after = tokens[i];
    if (!before || !after) continue;
    const gap = text.slice(before.end, after.start);
    if (/[^ \t\r\n]/.test(gap)) continue;
    const newline = gap.lastIndexOf("\n");
    const wanted = newline < 0 ? (after.kind === "colon" || after.kind === "angle" ? "" : " ") : gap.slice(0, newline + 1) + indent(1);
    if (wanted !== gap) yield { span: { start: before.end, length: gap.length }, newText: wanted };
  }
  for (const part of shape.parts) {
    if (part.kind !== "list") continue;
    const entries = part.entries ?? [];
    const open = { start: part.start, end: part.start + 1 };
    const close = { start: part.end - 1, end: part.end };
    const items: ShapeSpan[] = [open, ...entries, close];
    for (let i = 1; i < items.length; i++) {
      const before = items[i - 1];
      const after = items[i];
      if (!before || !after) continue;
      const gap = text.slice(before.end, after.start);
      const match = /^([ \t\r\n]*)(,?)([ \t\r\n]*)$/.exec(gap);
      if (!match) continue;
      const [, first = "", comma = "", rest = ""] = match;
      // without a comma the whole gap is what follows the entry; with one,
      // what stands before it goes (comma-first style is left as written)
      const lead = comma ? first : "";
      const trail = comma ? rest : first;
      if (lead.includes("\n")) continue;
      const level = after === close ? 1 : 2;
      const newline = trail.lastIndexOf("\n");
      const spacing = newline < 0 ? (comma && after !== close ? " " : "") : trail.slice(0, newline + 1) + indent(level);
      const wanted = comma + spacing;
      if (wanted !== gap) yield { span: { start: before.end, length: gap.length }, newText: wanted };
    }
  }
}
