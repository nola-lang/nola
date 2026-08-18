import { type BaseNode, type NolaFunctionNode, type NolaParamNode, sliceSpan, walk } from "@nola-lang/ast";
import { parseNola } from "@nola-lang/parser";
import { describe, expect, it } from "vitest";

function firstInferFn(ast: BaseNode): NolaFunctionNode | undefined {
  let out: NolaFunctionNode | undefined;
  walk(ast, (n) => {
    if (!out && n.type === "FunctionDeclaration" && n.nolaInfer) out = n as NolaFunctionNode;
  });
  return out;
}

const withBody = (params: string) => `infer function f(${params}) {\n  return 1;\n}\n`;

describe("`.param` contextual parameters", () => {
  it("parses `.name` on an infer function and records the `.` span", () => {
    const src = "infer function f(.user: string, limit: number) {\n  return 1;\n}\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const params = (firstInferFn(ast as BaseNode)?.params ?? []) as NolaParamNode[];
    expect(params[0]?.name).toBe("user");
    expect(params[0]?.nolaContextual).toBeDefined();
    expect(sliceSpan(src, params[0]?.nolaContextual as { start: number; end: number })).toBe(".");
    expect(params[1]?.nolaContextual).toBeUndefined();
  });

  it("works with a typed param and an instruction marker together", () => {
    const src = "infer function f`check it`(.user: { id: string }) {\n  return 1;\n}\n";
    const { ast, diagnostics } = parseNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const params = (firstInferFn(ast as BaseNode)?.params ?? []) as NolaParamNode[];
    expect(params[0]?.nolaContextual).toBeDefined();
  });

  it("several contextual params in one list", () => {
    const { ast, diagnostics } = parseNola(withBody(".a: string, b: number, .c: string[]"), "x.tsi");
    expect(diagnostics).toEqual([]);
    const params = (firstInferFn(ast as BaseNode)?.params ?? []) as NolaParamNode[];
    expect(params.map((p) => Boolean(p.nolaContextual))).toEqual([true, false, true]);
  });

  it("NOLA1010: `.` on a plain function's parameter", () => {
    const { diagnostics } = parseNola("function g(.x: string) {\n  return x;\n}\n", "x.tsi");
    expect(diagnostics[0]?.code).toBe("NOLA1010");
  });

  it("NOLA1011: `.` on a destructuring parameter is reserved", () => {
    const { diagnostics } = parseNola(withBody(".{ a }: { a: string }"), "x.tsi");
    expect(diagnostics[0]?.code).toBe("NOLA1011");
  });

  it("NOLA1011: `.` on a defaulted parameter is reserved", () => {
    const { diagnostics } = parseNola(withBody(".x = 1"), "x.tsi");
    expect(diagnostics[0]?.code).toBe("NOLA1011");
  });

  it("tolerant recovery: the param still parses (name intact) after NOLA1010", () => {
    const { ast, diagnostics } = parseNola("function g(.x: string) {\n  return x;\n}\n", "x.tsi", {
      tolerant: true,
    });
    expect(diagnostics[0]?.code).toBe("NOLA1010");
    let found = false;
    walk(ast as BaseNode, (n) => {
      if (n.type === "Identifier" && (n as { name?: string }).name === "x") found = true;
    });
    expect(found).toBe(true);
  });

  it("plain destructuring params in infer functions stay untouched", () => {
    const { diagnostics } = parseNola(withBody("[a]: string[]"), "x.tsi");
    expect(diagnostics).toEqual([]);
  });

  // The old two-dot spelling: unambiguous, so it gets its own message and
  // (tolerant) still parses as a contextual parameter — one diagnostic, no bail.
  describe("`..name` — the retired spelling", () => {
    it("strict mode reports NOLA1013", () => {
      const { ast, diagnostics } = parseNola(withBody("..user: string"), "x.tsi");
      expect(ast).toBeNull();
      expect(diagnostics[0]?.code).toBe("NOLA1013");
    });

    it("tolerant mode records NOLA1013 and keeps the param contextual", () => {
      const src = withBody("..user: string");
      const { ast, diagnostics } = parseNola(src, "x.tsi", { tolerant: true });
      expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1013"]);
      const params = (firstInferFn(ast as BaseNode)?.params ?? []) as NolaParamNode[];
      expect(params[0]?.name).toBe("user");
      expect(sliceSpan(src, params[0]?.nolaContextual as { start: number; end: number })).toBe("..");
    });

    it("on a plain function only NOLA1010 is reported", () => {
      const { diagnostics } = parseNola("function g(..x: string) {\n  return x;\n}\n", "x.tsi", { tolerant: true });
      expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1010"]);
    });
  });

  // The nameless marker: `(.` / `(.,` — the parameter name is still being
  // typed. super.parseBindingElement would reach unexpected(), which THROWS
  // even under errorRecovery — the file bails and the editor falls back to
  // stale lowered output. A single dot in a parameter list is unambiguously
  // the marker now, so both modes report NOLA1012 (strict throws on it).
  describe("nameless `.` context parameters", () => {
    for (const params of [".", "a: string, .", "..", "a: string, .."]) {
      it(`\`(${params})\` recovers into a placeholder param (tolerant)`, () => {
        const { ast, diagnostics } = parseNola(withBody(params), "x.tsi", { tolerant: true });
        expect(ast).not.toBeNull();
        expect(diagnostics.map((d) => d.code)).toContain("NOLA1012");
        const parsed = (firstInferFn(ast as BaseNode)?.params ?? []) as NolaParamNode[];
        expect(parsed.at(-1)?.nolaError).toBe(true);
      });
    }

    it("strict mode reports NOLA1012 for a nameless `.`", () => {
      const { ast, diagnostics } = parseNola(withBody("."), "x.tsi");
      expect(ast).toBeNull();
      expect(diagnostics[0]?.code).toBe("NOLA1012");
    });

    // A plain function has no marker to recover: the ordinary error stands.
    it("a plain function's parameter list is untouched", () => {
      expect(parseNola("function g(.) {\n  return 1;\n}\n", "x.tsi", { tolerant: true }).ast).toBeNull();
      expect(parseNola("function g(..) {\n  return 1;\n}\n", "x.tsi", { tolerant: true }).ast).toBeNull();
    });
  });

  // Contextual BINDINGS are the reason the marker is one dot (see spec
  // 2026-08-16); the form itself is not implemented yet, so it must fail with
  // the reserved-construct message, not a generic syntax error.
  describe("`const .x` contextual bindings are reserved (NOLA1014)", () => {
    for (const decl of ["const .bio = 1;", "let .bio = 1;", "var .bio;", "const ..bio = 1;"]) {
      it(`\`${decl}\` → NOLA1014 in strict mode`, () => {
        const { ast, diagnostics } = parseNola(`${decl}\n`, "x.tsi");
        expect(ast).toBeNull();
        expect(diagnostics[0]?.code).toBe("NOLA1014");
      });
    }

    it("tolerant mode records NOLA1014, parses the declarator and marks the id", () => {
      const src = "const .bio = 1;\n";
      const { ast, diagnostics } = parseNola(src, "x.tsi", { tolerant: true });
      expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1014"]);
      let marker: { start: number; end: number } | undefined;
      walk(ast as BaseNode, (n) => {
        if (n.type === "Identifier" && (n as { name?: string }).name === "bio") {
          marker = (n as { nolaReservedMarker?: { start: number; end: number } }).nolaReservedMarker;
        }
      });
      expect(marker && sliceSpan(src, marker)).toBe(".");
    });

    it("inside an infer function body too", () => {
      const src = "infer function f(.t: string) {\n  const .bio = ask ..`bio`<string>;\n  return bio;\n}\n";
      const { diagnostics } = parseNola(src, "x.tsi", { tolerant: true });
      expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1014"]);
    });
  });
});
