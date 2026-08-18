import { type BaseNode, Codes, children, isNode, sliceSpan, walk } from "@nola-lang/ast";
import { describe, expect, it } from "vitest";

const pos = (line: number, column: number) => ({ line, column });
const node = (type: string, start: number, end: number, extra: Record<string, unknown> = {}): BaseNode =>
  ({ type, start, end, loc: { start: pos(1, start), end: pos(1, end) }, ...extra }) as BaseNode;

describe("Codes", () => {
  it("has stable diagnostic codes", () => {
    expect(Codes.ParseError).toBe("NOLA1001");
    expect(Codes.AskAsIdentifier).toBe("NOLA1003");
    expect(Codes.ReservedConstruct).toBe("NOLA1004");
    expect(Codes.ExpectedPrompt).toBe("NOLA1005");
    expect(Codes.AskOutsideNolaFunction).toBe("NOLA2001");
    expect(Codes.UnsupportedIntentType).toBe("NOLA2002");
    expect(Codes.NolaFnNotTopLevel).toBe("NOLA2003");
  });
});

describe("v2 codes", () => {
  it("exposes the v2 diagnostic codes", () => {
    expect(Codes.InferWithoutFunction).toBe("NOLA1006");
    expect(Codes.LegacyMarker).toBe("NOLA1007");
    expect(Codes.SubstitutionInMarker).toBe("NOLA1008");
    expect(Codes.UntypedCallIntentArg).toBe("NOLA2004");
    expect(Codes.SubstitutionInCallMarker).toBe("NOLA2005");
    expect("SubstitutionInPrompt" in Codes).toBe(false);
  });
});

describe("isNode / children / walk", () => {
  it("identifies nodes structurally", () => {
    expect(isNode(node("Identifier", 0, 1))).toBe(true);
    expect(isNode(null)).toBe(false);
    expect(isNode({ start: 0 })).toBe(false);
  });

  it("children returns direct child nodes in source order", () => {
    const a = node("Identifier", 6, 7);
    const b = node("Identifier", 10, 11);
    const parent = node("BinaryExpression", 6, 11, { left: a, right: b, operator: "+" });
    expect(children(parent)).toEqual([a, b]);
  });

  it("children flattens arrays and skips loc", () => {
    const s1 = node("ExpressionStatement", 0, 4);
    const s2 = node("ExpressionStatement", 5, 9);
    const program = node("Program", 0, 9, { body: [s1, s2], directives: [] });
    expect(children(program)).toEqual([s1, s2]);
  });

  it("walk visits every node with its parent", () => {
    const inner = node("Identifier", 2, 3);
    const stmt = node("ExpressionStatement", 0, 4, { expression: inner });
    const program = node("Program", 0, 4, { body: [stmt] });
    const seen: Array<[string, string | null]> = [];
    walk(program, (n, parent) => seen.push([n.type, parent?.type ?? null]));
    expect(seen).toContainEqual(["Program", null]);
    expect(seen).toContainEqual(["ExpressionStatement", "Program"]);
    expect(seen).toContainEqual(["Identifier", "ExpressionStatement"]);
    expect(seen).toHaveLength(3);
  });
});

describe("sliceSpan", () => {
  it("slices by byte offsets", () => {
    expect(sliceSpan("const x = 1;", { start: 6, end: 7 })).toBe("x");
  });
});
