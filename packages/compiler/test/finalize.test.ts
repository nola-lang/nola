import { compileNola, compileView, finalizeDerivations } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";
import { typecheckLowered } from "./helpers/typecheck.js";

describe("finalizeDerivations", () => {
  it("replaces inert bodies, emits transitive accessors, view imports, UnsupportedType accessors; recomputes meta.views", () => {
    const src =
      'import type { Address } from "./geo.js";\nexport type User = { id: string; home: Address };\nexport type Weird = Map<string, number>;\nconst i = ..`x`<User>;\n';
    const p1 = compileNola(src, "/proj/src/m.tsi", { sourceRoot: "/proj" });
    const done = finalizeDerivations(p1, [
      {
        accessor: "__nola_type_$1",
        ok: true,
        expr: '__nola.types.ref("User", __nola_type_User)',
        accessors: [],
        imports: [],
        deps: [],
      },
      {
        accessor: "__nola_type_User",
        ok: true,
        expr: '__nola.types.object({ id: __nola.types.string(), home: __nola.types.ref("src/geo#Address", () => __nola_type_Address) })',
        accessors: [],
        imports: [{ specifier: "./geo.tsi", importedName: "Address", localBinding: "Address" }],
        deps: ["/proj/src/geo.ts"],
      },
      {
        accessor: "__nola_type_Weird",
        ok: false,
        reason: "unsupported type Map<string, number> at Weird",
        accessors: [],
        deps: [],
      },
    ]);
    expect(done.diagnostics).toEqual([]);
    expect(done.code).toContain(
      'function __nola_type_User(): import("@nola-lang/runtime").InferType<unknown> { return __nola.types.object({ id: __nola.types.string(), home: __nola.types.ref("src/geo#Address", () => __nola_type_Address) }); }',
    );
    expect(done.code).toContain(
      'function __nola_type_Weird(): import("@nola-lang/runtime").UnsupportedType<"unsupported type Map<string, number> at Weird"> { return __nola.types.unsupported(',
    );
    expect(done.code).toContain(
      'export const Weird = __nola_type_Weird() as unknown as import("@nola-lang/runtime").TypeValueOf<typeof __nola_type_Weird, Weird>;',
    );
    expect(done.code).toContain('import { Address as __nola_type_Address } from "./geo.tsi";');
    expect(done.code).toContain(
      'function __nola_type_$1(): import("@nola-lang/runtime").InferType<unknown> { return __nola.types.ref("User", __nola_type_User); }',
    );
    expect(done.code).not.toContain("(undefined as never)");
    expect(done.meta.views).toEqual(["./geo.tsi"]);
    // body untouched, spans still tile the output
    expect(done.code.slice(0, p1.meta.appendixStart)).toBe(p1.code.slice(0, p1.meta.appendixStart));
    const last = done.meta.spans[done.meta.spans.length - 1];
    expect(last?.kind).toBe("appendix");
    expect(last?.generatedEnd).toBe(done.code.length);
    // the finalized appendix type-checks against the stub (UnsupportedType elaboration included)
    expect(typecheckLowered({ "m.ts": done.code, "geo.ts": "export interface Address { city: string }", "geo.tsi.ts": 'export const Address = 1 as unknown as import("@nola-lang/runtime").InferType<{ city: string }>;' })).toEqual([]);
  });

  it("an ok:false extract answer is NOLA2002 at the source <T>; a context answer honours the policy", () => {
    const src = "export infer function f(.x: Map<string, number>) {\n  return ask ..`y`<Set<string>>;\n}\n";
    const p1 = compileNola(src, "/proj/src/m.tsi", { sourceRoot: "/proj", underivableContextType: "error" });
    const fail = (accessor: string, reason: string) => ({ accessor, ok: false as const, reason, accessors: [], deps: [] });
    const done = finalizeDerivations(p1, [
      fail("__nola_type_$1", "unsupported type Map<string, number> at x"),
      fail("__nola_type_$2", "unsupported type Set<string> at y"),
    ]);
    expect(done.diagnostics.map((d) => [d.code, src.slice(d.start, d.end)])).toEqual([
      ["NOLA2008", "Map<string, number>"],
      ["NOLA2002", "Set<string>"],
    ]);
    expect(done.diagnostics[0]?.message).toContain("underivableContextType");
    expect(done.code).toContain(
      'function __nola_type_$1(): import("@nola-lang/runtime").InferType<unknown> | undefined { return undefined; }',
    );
    const omit = finalizeDerivations(
      compileNola(src, "/proj/src/m.tsi", { sourceRoot: "/proj", underivableContextType: "omit" }),
      [
        fail("__nola_type_$1", "r"),
        { accessor: "__nola_type_$2", ok: true, expr: "__nola.types.string()", accessors: [], imports: [], deps: [] },
      ],
    );
    expect(omit.diagnostics).toEqual([]);
    expect(typecheckLowered({ "m.ts": omit.code })).toEqual([]);
  });

  it("a NOLA2012 answer is a hard error at every site kind — no UnsupportedType, no policy", () => {
    const src = "export type T = { a: string };\nexport infer function f(.x: T) {\n  return ask ..`y`<T>;\n}\n";
    const p1 = compileNola(src, "/proj/src/m.tsi", { sourceRoot: "/proj", underivableContextType: "omit" });
    const bad = (accessor: string) => ({
      accessor,
      ok: false as const,
      reason: "property 'a' of T: @minimum applies to numbers, not to string",
      code: "NOLA2012",
      accessors: [],
      deps: [],
    });
    const done = finalizeDerivations(p1, p1.meta.derivations.map((r) => bad(r.accessor)));
    expect(done.diagnostics.map((d) => d.code)).toEqual(["NOLA2012", "NOLA2012", "NOLA2012"]);
    expect(done.diagnostics.every((d) => d.message.includes("@minimum applies to numbers"))).toBe(true);
    expect(done.code).not.toContain("UnsupportedType");
    expect(typecheckLowered({ "m.ts": done.code })).toEqual([]);
  });

  it("a missing answer is an internal error, never silent inert code", () => {
    const p1 = compileNola("const i = ..`x`<string>;\n", "/proj/src/m.tsi");
    expect(() => finalizeDerivations(p1, [])).toThrow(/no answer for __nola_type_\$1/);
  });

  it("a file with no derivation site is returned unchanged", () => {
    const p1 = compileNola("const i = ..`x`;\n", "/proj/src/m.tsi");
    expect(finalizeDerivations(p1, [])).toBe(p1);
  });

  it("finalizes a view the same way (values before the accessor block, accessors last)", () => {
    const view = compileView("export interface P { n: number }\nexport type W = Map<string, number>;\n", "/proj/src/models.ts", {
      sourceRoot: "/proj",
    });
    expect(view.derivations.map((d) => [d.accessor, d.name])).toEqual([
      ["__nola_type_P", "P"],
      ["__nola_type_W", "W"],
    ]);
    expect(view.code.slice(view.derivations[0]?.lowered.start, view.derivations[0]?.lowered.end)).toBe("P");
    const done = finalizeDerivations(view, [
      { accessor: "__nola_type_P", ok: true, expr: "__nola.types.object({ n: __nola.types.number() })", accessors: [], imports: [], deps: [] },
      { accessor: "__nola_type_W", ok: false, reason: "unsupported type Map<string, number> at W", accessors: [], deps: [] },
    ]);
    expect(done.code).toContain('export const P = __nola_type_P() as unknown as import("@nola-lang/runtime").TypeValueOf<typeof __nola_type_P, P>;');
    expect(done.code).toContain("function __nola_type_P(): import(\"@nola-lang/runtime\").InferType<unknown> { return __nola.types.object({ n: __nola.types.number() }); }");
    expect(done.code).toMatch(/function __nola_type_W\(\): import\("@nola-lang\/runtime"\)\.UnsupportedType<"[^"]+">/);
    expect(done.code.indexOf("export const P")).toBeLessThan(done.code.indexOf("function __nola_type_P"));
    const models = "export interface P { n: number }\nexport type W = Map<string, number>;\n";
    const consumer = 'import { P, W } from "./models.tsi";\nexport const s = P.toJsonSchema();\nexport const bad = W.toJsonSchema();\n';
    const errors = typecheckLowered({ "consumer.ts": consumer, "models.ts": models, "models.tsi.ts": done.code });
    expect(errors.join("\n")).toContain("unsupported type Map<string, number> at W");
    expect(errors.filter((e) => e.includes("consumer.ts:2"))).toEqual([]);
  });
});
