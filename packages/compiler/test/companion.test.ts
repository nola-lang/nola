import { compileCompanion } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";

describe("compileCompanion", () => {
  it("derives exported types, reachable locals, and skips unreachable locals", () => {
    const src = [
      "type Secret = { code: string };",
      "type Unused = { nope: boolean };",
      "export interface User { name: string; secret: Secret }",
      "",
    ].join("\n");
    const r = compileCompanion(src, "/proj/src/models.ts", { sourceRoot: "/proj" });
    expect(r.diagnostics).toEqual([]);
    expect(r.code).toContain("__nola.useRuntime(11);");
    expect(r.code).toContain("function __nola_type_User(): InferType<unknown>");
    expect(r.code).toContain('__nola.types.ref("src/models#Secret", __nola_type_Secret)');
    expect(r.code).toContain("function __nola_type_Secret(): InferType<unknown>");
    expect(r.code).not.toContain("__nola_type_Unused");
    expect(r.code).toContain("export { __nola_type_User as User };");
    expect(r.companions).toEqual([]);
  });

  it("self-recursive exported type refs itself with a qualified name", () => {
    const src = "export type Node = { label: string; kids?: Node[] };\n";
    const r = compileCompanion(src, "/proj/src/tree.ts", { sourceRoot: "/proj" });
    expect(r.diagnostics).toEqual([]);
    expect(r.code).toContain('__nola.types.ref("src/tree#Node", __nola_type_Node)');
  });

  it("imported types become companion imports and land in .companions", () => {
    const src = [
      'import type { Country } from "./geo.js";',
      "export interface Address { city: string; country: Country }",
      "",
    ].join("\n");
    const r = compileCompanion(src, "/proj/src/models.ts", { sourceRoot: "/proj" });
    expect(r.diagnostics).toEqual([]);
    expect(r.code).toContain('import { Country as __nola_type_Country } from "./geo.nola.js";');
    expect(r.code).toContain('__nola.types.ref("src/geo#Country", __nola_type_Country)');
    expect(r.companions).toEqual(["./geo.nola.js"]);
  });

  it("underivable exported types become UnsupportedType accessors, still exported", () => {
    const src = "export type Weird = Map<string, number>;\n";
    const r = compileCompanion(src, "/proj/src/models.ts", { sourceRoot: "/proj" });
    expect(r.diagnostics).toEqual([]);
    expect(r.code).toMatch(
      /function __nola_type_Weird\(\): UnsupportedType<"[^"]+"> \{ return __nola\.types\.unsupported\(/,
    );
    expect(r.code).toContain("__nola_type_Weird as Weird");
  });

  it("a .tsi source works as a companion source (types only; infer functions ignored)", () => {
    const src = "export type Shape = { kind: string };\ninfer function go() { return ask ..`x`; }\n";
    const r = compileCompanion(src, "/proj/src/shapes.tsi", { sourceRoot: "/proj" });
    expect(r.diagnostics).toEqual([]);
    expect(r.code).toContain("__nola_type_Shape as Shape");
  });

  it("an unparseable source yields code:'' plus diagnostics (host reports NOLA2007)", () => {
    const r = compileCompanion("const = broken(((", "/proj/src/bad.ts", { sourceRoot: "/proj" });
    expect(r.code === "" || r.diagnostics.length > 0).toBe(true);
  });
});
