// biome-ignore-all lint/suspicious/noTemplateCurlyInString: .tsi fixtures contain literal ${} interpolation
import { compileNola } from "@nola-lang/compiler";
import { sha256Hex } from "@nola-lang/core";
import { describe, expect, it } from "vitest";
import { defHash } from "../src/lower/templates.js";

const lower = (source: string): string => {
  const { code, diagnostics } = compileNola(source, "/proj/src/x.tsi", { sourceRoot: "/proj" });
  expect(diagnostics).toEqual([]);
  return code;
};

describe("def stamps (AskDefinition spec §2)", () => {
  it("matches the spec recipe", () => {
    expect(defHash("src/x.tsi", "extract", "a prompt", "string")).toBe(
      sha256Hex("nola-def:1\nsrc/x.tsi\nextract\na prompt\nstring"),
    );
  });

  it("extractor: def hashes file + raw text (holes verbatim) + type source; line shifts don't change it", () => {
    const src = "export infer function f(.name: string) {\n  return ask ..`hello ${.name}`<string>;\n}\n";
    const expected = defHash("src/x.tsi", "extract", "hello ${.name}", "string");
    expect(lower(src)).toContain(`def: ${JSON.stringify(expected)}`);
    // Two blank lines above: the ask moved — same def.
    expect(lower(`\n\n${src}`)).toContain(`def: ${JSON.stringify(expected)}`);
  });

  it("lexical holes stay verbatim in the hash input — never values", () => {
    const src = "const topic = 1;\nconst i = ..`about ${topic}`<string>;\n";
    expect(lower(src)).toContain(`def: ${JSON.stringify(defHash("src/x.tsi", "extract", "about ${topic}", "string"))}`);
  });

  it("untyped extractor hashes an empty type text; editing the instruction re-keys", () => {
    expect(lower("const i = ..`alpha`;\n")).toContain(
      `def: ${JSON.stringify(defHash("src/x.tsi", "extract", "alpha", ""))}`,
    );
    expect(lower("const i = ..`beta`;\n")).toContain(
      `def: ${JSON.stringify(defHash("src/x.tsi", "extract", "beta", ""))}`,
    );
  });

  it("call intent: def hashes callee text + raw hint (empty for the marker-less form)", () => {
    const hinted = lower(
      'declare function go(x: string): Promise<number>;\nexport infer function f() {\n  return ask go`fast`("x");\n}\n',
    );
    expect(hinted).toContain(`def: ${JSON.stringify(defHash("src/x.tsi", "call", "go", "fast"))}`);
    const bare = lower(
      "declare function go(x: string): Promise<number>;\nexport infer function f() {\n  return ask go``(`x`);\n}\n",
    );
    expect(bare).toContain(`def: ${JSON.stringify(defHash("src/x.tsi", "call", "go", ""))}`);
  });
});
