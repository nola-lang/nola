import { collectExportedTypeNames, collectTopLevelValueNames } from "@nola-lang/compiler";
import { parseNola } from "@nola-lang/parser";
import { describe, expect, it } from "vitest";

const SRC = [
  "export type A = { a: string };",
  "export interface B { b: number }",
  'export enum E { X = "x" }',
  "type Hidden = { h: string };",
  "export const A2 = 1;",
  "let l = 2;",
  "function fn() {}",
  "export class K {}",
  "enum Plain { P = 'p' }",
  "export { Hidden };",
  "",
].join("\n");

describe("declaration collectors", () => {
  it("collectExportedTypeNames lists exported alias/interface/enum declarations in order", () => {
    const { ast } = parseNola(SRC, "x.tsi");
    const decls = collectExportedTypeNames(ast as never);
    expect(decls.map((d) => [d.name, d.kind])).toEqual([
      ["A", "alias"],
      ["B", "interface"],
      ["E", "enum"],
    ]);
    // the statement is the export wrapper, the node the declaration inside it
    expect(decls[0]?.statement.type).toBe("ExportNamedDeclaration");
    expect(decls[0]?.node.type).toBe("TSTypeAliasDeclaration");
  });

  it("collectTopLevelValueNames sees every value binding, exported or not, enums included", () => {
    const { ast } = parseNola(SRC, "x.tsi");
    expect([...collectTopLevelValueNames(ast as never)].sort()).toEqual(["A2", "E", "K", "Plain", "fn", "l"]);
  });
});
