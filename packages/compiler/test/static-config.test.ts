import { staticUnderivableContextType } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";

describe("staticUnderivableContextType", () => {
  it("reads the literal from a plain default-exported object", () => {
    const src = 'export default { compiler: { underivableContextType: "prune" } };\n';
    expect(staticUnderivableContextType(src)).toBe("prune");
  });

  it("unwraps a defineConfig call", () => {
    const src = [
      'import { defineConfig } from "nola-lang";',
      "export default defineConfig({",
      "  providers: { default: someProvider() },",
      '  compiler: { underivableContextType: "omit" },',
      "});",
      "",
    ].join("\n");
    expect(staticUnderivableContextType(src)).toBe("omit");
  });

  it("unwraps as/satisfies and parenthesized expressions", () => {
    expect(
      staticUnderivableContextType(
        'export default ({ compiler: { underivableContextType: "prune" } as const }) satisfies object;\n',
      ),
    ).toBe("prune");
  });

  it("follows one level of top-level identifier indirection", () => {
    const src = [
      'const config = { compiler: { underivableContextType: "error" } };',
      "export default config;",
      "",
    ].join("\n");
    expect(staticUnderivableContextType(src)).toBe("error");
  });

  it("returns undefined for a computed value (editor falls back to the default)", () => {
    const src = 'export default { compiler: { underivableContextType: process.env.CI ? "omit" : "error" } };\n';
    expect(staticUnderivableContextType(src)).toBeUndefined();
  });

  it("returns undefined when there is no compiler section, no default export, or an unknown mode", () => {
    expect(staticUnderivableContextType("export default { providers: {} };\n")).toBeUndefined();
    expect(staticUnderivableContextType("export const x = 1;\n")).toBeUndefined();
    expect(
      staticUnderivableContextType('export default { compiler: { underivableContextType: "loose" } };\n'),
    ).toBeUndefined();
  });

  it("survives a syntactically broken config", () => {
    expect(staticUnderivableContextType("export default { compiler: {")).toBeUndefined();
  });
});
