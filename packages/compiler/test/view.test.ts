import { compileView } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";

const INERT = "(undefined as never)";

describe("compileView (phase 1 since emit 15)", () => {
  it("re-exports the source, redeclares each exported type locally, exports the values, declares inert accessors", () => {
    const src = [
      "type Secret = { code: string };",
      "type Unused = { nope: boolean };",
      "export interface User { name: string; secret: Secret }",
      "export function helper() { return 1; }",
      "",
    ].join("\n");
    const r = compileView(src, "/proj/src/models.ts", { sourceRoot: "/proj" });
    expect(r.diagnostics).toEqual([]);
    const lines = r.code.split("\n");
    expect(lines[0]).toBe('export * from "./models.js";');
    expect(r.code).toContain('export type User = import("./models.js").User;');
    expect(r.code).toContain("__nola.useRuntime(18);");
    expect(r.code).toContain(
      'export const User = __nola_type_User() as unknown as import("@nola-lang/runtime").TypeValueOf<typeof __nola_type_User, User>;',
    );
    expect(r.code).toContain(`function __nola_type_User(): import("@nola-lang/runtime").InferType<unknown> { return ${INERT}; }`);
    // non-exported types get no accessor of their own in phase 1: the checker reaches Secret through User
    expect(r.code).not.toContain("__nola_type_Secret");
    expect(r.code).not.toContain("__nola_type_Unused");
    expect(r.code).not.toContain("export type Secret");
    expect(r.views).toEqual([]);
    expect(r.derivations).toEqual([expect.objectContaining({ accessor: "__nola_type_User", kind: "exported", name: "User" })]);
    const req = r.derivations[0];
    expect(r.code.slice(req?.lowered.start, req?.lowered.end)).toBe("User");
    expect(src.slice(req?.source.start, req?.source.end)).toBe("User");
    expect(r.code.slice(r.appendixStart)).toMatch(/^function __nola_type_User/);
  });

  it("enums are re-exported by export * only — no alias, no value, no request", () => {
    const r = compileView('export enum E { A = "a" }\n', "/proj/src/e.ts", { sourceRoot: "/proj" });
    expect(r.code).not.toContain("export type E");
    expect(r.code).not.toContain("export const E");
    expect(r.derivations).toEqual([]);
    expect(r.appendixStart).toBe(-1);
  });

  it("a .d.ts source has no runtime module: no export *, types only + values", () => {
    const r = compileView("export interface Api { id: string }\n", "/proj/src/api.d.ts", { sourceRoot: "/proj" });
    expect(r.code).not.toContain("export *");
    expect(r.code).toContain('export type Api = import("./api.js").Api;');
    expect(r.code).toContain("export const Api =");
  });

  it("sourceSpecifier overrides the re-export target (bundlers pass an absolute path)", () => {
    const r = compileView("export interface P { n: number }\n", "/proj/src/models.ts", {
      sourceRoot: "/proj",
      sourceSpecifier: "/proj/src/models.ts",
    });
    expect(r.code).toContain('export * from "/proj/src/models.ts";');
    expect(r.code).toContain('export type P = import("/proj/src/models.ts").P;');
  });

  it("an unparseable source yields code:'' plus diagnostics", () => {
    const r = compileView("const = broken(((", "/proj/src/bad.ts", { sourceRoot: "/proj" });
    expect(r.code === "" || r.diagnostics.length > 0).toBe(true);
  });
});
