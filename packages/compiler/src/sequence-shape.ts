import { type BaseNode, type NolaAskExpression, type NolaExtractExpression, type NolaToolListNode, walk } from "@nola-lang/ast";
import { parseNola } from "@nola-lang/parser";

/** A token's `[start, end)` offsets into the source. */
export interface ShapeSpan {
  start: number;
  end: number;
}

export interface ShapePart extends ShapeSpan {
  kind: "text" | "value" | "list";
  /** a list's entries as written, in order — a spread with its dots */
  entries?: ShapeSpan[];
}

export type ShapeType =
  /** `: T` — the colon's offset and the type's text after it */
  | { kind: "colon"; colon: number; text: ShapeSpan }
  /** `<T>`, the brackets included */
  | ({ kind: "angle" } & ShapeSpan);

/**
 * Where an ask sequence's tokens stand in the source (ask-sequence spec
 * §3.12): what a formatter needs to lay the sequence out, since TypeScript's
 * formatter reads `` ask `x` [a] `y`: T `` as tagged templates and an index.
 */
export interface SequenceShape extends ShapeSpan {
  /** the tokens before the first text — `ask`, or `ask` `with` and the alias; none for the `..` form and a slot template */
  head: ShapeSpan[];
  parts: ShapePart[];
  type: ShapeType | null;
}

const WITH_BETWEEN = /^\s*with\s*$/;

/**
 * The shapes of every extractor in `source`, in source order, read off a
 * tolerant parse: an `ask` / `ask with <name>` operand (the extent starts at
 * `ask`), a stored `..` extractor (at the sigil) and a slot template (at its
 * backtick) alike. A tolerant placeholder is skipped; `null` when even the
 * tolerant parse bails, so a caller does not guess. Context statements are
 * not shapes: their gaps lower inside one tagged template, so the replaced
 * spans already keep a formatter out of them.
 */
export function sequenceShapes(source: string, file: string): SequenceShape[] | null {
  const { ast } = parseNola(source, file, { tolerant: true });
  if (!ast) return null;
  const asks = new Map<BaseNode, NolaAskExpression>();
  const extractors: NolaExtractExpression[] = [];
  walk(ast, (node) => {
    if (node.type === "NolaAskExpression") {
      const ask = node as NolaAskExpression;
      if (ask.argument?.type === "NolaExtractExpression") asks.set(ask.argument, ask);
    } else if (node.type === "NolaExtractExpression") {
      extractors.push(node as NolaExtractExpression);
    }
  });
  const shapes: SequenceShape[] = [];
  for (const node of extractors) {
    if (node.nolaError || !node.quasi || node.parts.length === 0) continue;
    const ask = asks.get(node);
    const head: ShapeSpan[] = [];
    let start = node.start;
    if (ask) {
      start = ask.start;
      const keyword = { start: ask.start, end: ask.start + "ask".length };
      head.push(keyword);
      if (ask.provider) {
        const between = source.slice(keyword.end, ask.provider.start);
        if (WITH_BETWEEN.test(between)) {
          const withStart = keyword.end + between.indexOf("with");
          head.push({ start: withStart, end: withStart + "with".length }, { start: ask.provider.start, end: ask.provider.end });
        }
      }
    }
    const parts = node.parts.map((part): ShapePart => {
      if (part.type === "TemplateLiteral") return { kind: "text", start: part.start, end: part.end };
      if (part.type === "NolaToolList") {
        const list = part as NolaToolListNode;
        return { kind: "list", start: list.start, end: list.end, entries: list.entries.map((e) => ({ start: e.start, end: e.end })) };
      }
      const span = (part as { nolaValueSpan?: ShapeSpan }).nolaValueSpan ?? part;
      return { kind: "value", start: span.start, end: span.end };
    });
    let type: ShapeType | null = null;
    if (node.typeArgs) {
      if (node.colonType) {
        const colon = node.typeArgs.start;
        const after = source.slice(colon + 1, node.typeArgs.end);
        const textStart = colon + 1 + (after.length - after.trimStart().length);
        type = { kind: "colon", colon, text: { start: textStart, end: node.typeArgs.end } };
      } else {
        type = { kind: "angle", start: node.typeArgs.start, end: node.typeArgs.end };
      }
    }
    const last = parts[parts.length - 1];
    const end = Math.max(node.end, last ? last.end : 0, type ? (type.kind === "colon" ? type.text.end : type.end) : 0);
    shapes.push({ start, end, head, parts, type });
  }
  shapes.sort((a, b) => a.start - b.start);
  return shapes;
}
