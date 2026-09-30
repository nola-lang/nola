// biome-ignore-all lint/suspicious/noTemplateCurlyInString: .tsi fixtures contain literal ${} interpolation
import type { BaseNode } from "@nola-lang/ast";
import { parseNola } from "@nola-lang/parser";
import { describe, expect, it } from "vitest";

const wrap = (body: string) => `infer function f(user: string) {\n${body}\n}\n`;
const bodyOf = (ast: unknown) =>
  ((ast as { program: { body: Array<{ body: { body: BaseNode[] } }> } }).program.body[0]?.body.body ?? []) as BaseNode[];

// The half-typed states of a context statement are the editor's daily bread.
// None of them may bail the file: a bail serves stale last-good output whose
// mappings describe an older text.
describe("tolerant recovery: context statements", () => {
  it("a value still being typed is an ordinary identifier — no diagnostic", () => {
    const { ast, diagnostics } = parseNola(wrap("  `Page` onc"), "t.tsi", { tolerant: true });
    expect(diagnostics).toEqual([]);
    expect(bodyOf(ast)[0]?.type).toBe("NolaContextStatement");
  });

  it("a dangling dot in a value takes the member recovery — no diagnostic, the file goes on", () => {
    const { ast, diagnostics } = parseNola(wrap("  `Page` oncall.\n  return 1;"), "t.tsi", { tolerant: true });
    expect(diagnostics).toEqual([]);
    expect(bodyOf(ast).map((s) => s.type)).toEqual(["NolaContextStatement", "ReturnStatement"]);
  });

  it("NOLA1020 is recorded and the statement ends before the token, which starts the next statement", () => {
    const { ast, diagnostics } = parseNola(wrap("  `text` user + 1;\n  return 1;"), "t.tsi", { tolerant: true });
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1020"]);
    const body = bodyOf(ast);
    expect(body[0]?.type).toBe("NolaContextStatement");
    expect((body[0] as { parts: BaseNode[] }).parts.map((p) => p.type)).toEqual(["TemplateLiteral", "Identifier"]);
    // `+ 1;` parses as a unary expression statement of its own
    expect(body[1]?.type).toBe("ExpressionStatement");
    expect(body[2]?.type).toBe("ReturnStatement");
  });

  it("NOLA1020 after text (`ask` on the same line) recovers the same way", () => {
    const { ast, diagnostics } = parseNola(wrap("  `text` ask `p`<string>;\n  return 1;"), "t.tsi", { tolerant: true });
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1020"]);
    expect(bodyOf(ast)[0]?.type).toBe("NolaContextStatement");
    expect(bodyOf(ast).at(-1)?.type).toBe("ReturnStatement");
  });

  it("NOLA1020 after text (`this` on the same line) is recorded without a bail; the statement ends before it", () => {
    const { ast, diagnostics } = parseNola(wrap("  `Page` this.user `now`;\n  return 1;"), "t.tsi", { tolerant: true });
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1020"]);
    const body = bodyOf(ast);
    expect(body[0]?.type).toBe("NolaContextStatement");
    expect((body[0] as { parts: BaseNode[] }).parts.map((p) => p.type)).toEqual(["TemplateLiteral"]);
    // `this.user `now`;` is an ordinary statement of its own: a tag call on a member, and the file goes on
    expect(body[1]?.type).toBe("ExpressionStatement");
    expect(body[2]?.type).toBe("ReturnStatement");
  });

  it("a reserved `(..)` in a value keeps the extractor placeholder (NOLA1004), the statement parses", () => {
    const { ast, diagnostics } = parseNola(wrap("  `call` foo(..) `if needed`;"), "t.tsi", { tolerant: true });
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1004"]);
    expect(bodyOf(ast)[0]?.type).toBe("NolaContextStatement");
  });

  it("a value at the end of the file ends the statement", () => {
    const { ast, diagnostics } = parseNola("`text` user", "t.tsi", { tolerant: true });
    expect(diagnostics).toEqual([]);
    expect((ast as { program: { body: BaseNode[] } }).program.body[0]?.type).toBe("NolaContextStatement");
  });
});
