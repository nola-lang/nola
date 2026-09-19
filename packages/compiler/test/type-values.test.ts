import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";

const INERT = "(undefined as never)";
// On the SAME line as the declaration's end: lowering keeps the source's line
// layout outside the appendix (the debugger binds raw .tsi lines as well as mapped ones).
const VALUE = (name: string) =>
  ` export const ${name} = __nola_type_${name}() as unknown as import("@nola-lang/runtime").TypeValueOf<typeof __nola_type_${name}, ${name}>;`;

describe("exported types become values (emit 14; phase-1 shape since emit 15)", () => {
  it("inserts the value right after the declaration and hoists ONE inert accessor in the appendix", () => {
    const src = ["export type User = { id: string; tags?: string[] };", "export interface Box { w: number }", ""].join(
      "\n",
    );
    const { code, diagnostics, meta } = compileNola(src, "/proj/src/m.tsi", { sourceRoot: "/proj" });
    expect(diagnostics).toEqual([]);
    expect(code).toContain(`export type User = { id: string; tags?: string[] };${VALUE("User")}`);
    expect(code).toContain(`export interface Box { w: number }${VALUE("Box")}`);
    expect(code.match(/function __nola_type_User\(/g)).toHaveLength(1);
    expect(code).toContain(`function __nola_type_Box(): import("@nola-lang/runtime").InferType<unknown> { return ${INERT}; }`);
    expect(code).toContain("__nola.useRuntime(18);");
    expect(meta.mode).toBe("lowered");
    expect(meta.derivations.map((d) => [d.accessor, d.kind, d.name])).toEqual([
      ["__nola_type_User", "exported", "User"],
      ["__nola_type_Box", "exported", "Box"],
    ]);
  });

  it("an extractor referencing the type gets its own site accessor; the named accessor exists once", () => {
    const src = [
      "export type User = { id: string };",
      "export infer function load() {",
      "  const u = ask ..`user`<User>;",
      "  return u;",
      "}",
      "",
    ].join("\n");
    const { code, diagnostics, meta } = compileNola(src, "/proj/src/m.tsi", { sourceRoot: "/proj" });
    expect(diagnostics).toEqual([]);
    expect(code.match(/function __nola_type_User\(/g)).toHaveLength(1);
    expect(code).toContain("type: __nola_type_$1(), loc:");
    expect(code).toContain(VALUE("User"));
    expect(meta.derivations.map((d) => d.accessor)).toEqual(["__nola_type_$1", "__nola_type_User"]);
  });

  it("a top-level statement may use the value after its declaration (const is not hoisted, the accessor is)", () => {
    const src = ["export type P = { x: number };", "export const schema = P.toJsonSchema();", ""].join("\n");
    const { code, diagnostics } = compileNola(src, "/proj/src/m.tsi", { sourceRoot: "/proj" });
    expect(diagnostics).toEqual([]);
    expect(code.indexOf(VALUE("P"))).toBeLessThan(code.indexOf("export const schema"));
  });

  it("non-exported types and enums get no value", () => {
    const src = ["type Hidden = { h: string };", 'export enum E { A = "a" }', ""].join("\n");
    const { code, meta } = compileNola(src, "/proj/src/m.tsi", { sourceRoot: "/proj" });
    expect(code).toBe(src); // nothing to lower: no appendix at all
    expect(meta.derivations).toEqual([]);
  });

  it("phase 1 cannot know derivability: an exotic exported type still gets the same inert accessor and cast", () => {
    // finalizeDerivations turns the accessor into UnsupportedType<reason>; the
    // TypeValueOf cast then resolves to the elaboration (finalize.test.ts).
    const src = "export type Weird = Map<string, number>;\n";
    const { code, diagnostics } = compileNola(src, "/proj/src/m.tsi", { sourceRoot: "/proj" });
    expect(diagnostics).toEqual([]);
    expect(code).toContain(VALUE("Weird"));
    expect(code).toContain(`function __nola_type_Weird(): import("@nola-lang/runtime").InferType<unknown> { return ${INERT}; }`);
  });

  it("NOLA2011 when a value already uses an exported type's name; no value is inserted", () => {
    const src = ["export type User = { id: string };", "const User = 1;", ""].join("\n");
    const { code, diagnostics } = compileNola(src, "/proj/src/m.tsi", { sourceRoot: "/proj" });
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA2011"]);
    expect(diagnostics[0]?.start).toBe(src.indexOf("type User"));
    expect(code).not.toContain("export const User =");
  });

  it("the insert is a zero-source-length replaced span right after the statement", () => {
    const src = "export type P = { x: number };\nconst y = 1;\n";
    const { meta } = compileNola(src, "/proj/src/m.tsi", { sourceRoot: "/proj" });
    const end = src.indexOf(";") + 1;
    const insert = meta.spans.find((s) => s.kind === "replaced" && s.sourceStart === end && s.sourceEnd === end);
    expect(insert).toBeDefined();
    expect(insert && insert.generatedEnd - insert.generatedStart).toBe(VALUE("P").length);
  });
});
