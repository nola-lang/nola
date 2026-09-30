import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";
import { typecheckLowered } from "./helpers/typecheck.js";

// Colon-typed extractors (spec 2026-09-23): `: T` lowers byte-identically to
// `<T>` — same emit, same def — because the lowerer only reads typeArgs.params[0]
// and replaces whatever follows the template with the suffix.
function pair(lt: string, colon: string) {
  const a = compileNola(lt, "t.tsi");
  const b = compileNola(colon, "t.tsi");
  expect(a.diagnostics).toEqual([]);
  expect(b.diagnostics).toEqual([]);
  expect(b.code).toBe(a.code);
  return { a, b };
}

describe("extractor `: T` lowering", () => {
  it("a module-level ask lowers byte-identically to `<T>`, with the anchor and derivation request on the written type", () => {
    const colon = "const a = ask `user id`: number;\n";
    const { b } = pair("const a = ask `user id`<number>;\n", colon);
    const [anchor] = b.meta.anchors;
    expect(anchor).toBeDefined();
    expect(colon.slice(anchor?.sourceStart, anchor?.sourceEnd)).toBe("number");
    expect(b.code.slice(anchor?.generatedStart, anchor?.generatedEnd)).toBe("number");
    expect(b.meta.derivations.map((d) => ({ kind: d.kind, text: colon.slice(d.source.start, d.source.end) }))).toEqual([
      { kind: "extract", text: "number" },
    ]);
    expect(typecheckLowered({ "t.ts": b.code })).toEqual([]);
  });

  it("an infer-body ask, a call slot and a decision type lower byte-identically to `<T>`", () => {
    pair(
      "infer function g(.doc: string) {\n  const id = ask `id`<string>;\n  return id;\n}\n",
      "infer function g(.doc: string) {\n  const id = ask `id`: string;\n  return id;\n}\n",
    );
    pair(
      "declare function f(a: string): void;\nconst i = f(..`a`<string>);\n",
      "declare function f(a: string): void;\nconst i = f(..`a`: string);\n",
    );
    const { b } = pair('const d = ask `q`<Choice<"a" | "b">>;\n', 'const d = ask `q`: Choice<"a" | "b">;\n');
    expect(b.code).toContain('ExtractIntent<Choice<"a" | "b">>');
    expect(b.code).toContain('import type { Choice } from "@nola-lang/runtime"');
  });

  it("a method chain after a delimited type type-checks clean", () => {
    const r = compileNola("const r = ask `p`: string[].withRetry(2);\n", "t.tsi");
    expect(r.diagnostics).toEqual([]);
    expect(r.code).toContain("ExtractIntent<string[]>(");
    expect(r.code).toContain("}).withRetry(2)");
    expect(typecheckLowered({ "t.ts": r.code })).toEqual([]);
  });

  it("tolerant: a colon with no type keeps the file lowered — NOLA1018, the extractor untyped, the next line verbatim", () => {
    const r = compileNola("const x = ask `p`:\nconsole.log(1);\n", "t.tsi", { tolerant: true });
    expect(r.meta.mode).toBe("lowered");
    expect(r.diagnostics.map((d) => d.code)).toEqual(["NOLA1018"]);
    expect(r.code).toContain("ExtractIntent<any>(");
    expect(r.code).toContain("\nconsole.log(1);\n");
    expect(typecheckLowered({ "t.ts": r.code })).toEqual([]);
  });
});
