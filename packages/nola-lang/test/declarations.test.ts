import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adjacentDeclarationPath, emitAdjacentDeclarations } from "../src/declarations.js";

describe("adjacentDeclarationPath", () => {
  it("maps report.tsi to report.d.tsi.ts (allowArbitraryExtensions naming)", () => {
    expect(adjacentDeclarationPath("/a/b/report.tsi")).toBe("/a/b/report.d.tsi.ts");
  });
});

describe("emitAdjacentDeclarations", () => {
  it("writes <base>.d.tsi.ts next to each .tsi", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nola-decl-"));
    writeFileSync(
      join(dir, "greet.tsi"),
      "export infer function greet(.name: string) {\n  return ask ..`hello`<string>;\n}\n",
    );
    const { written, errors } = await emitAdjacentDeclarations(dir);
    expect(errors).toEqual([]);
    const dts = join(dir, "greet.d.tsi.ts");
    expect(written).toContain(dts);
    const text = readFileSync(dts, "utf8");
    expect(text).toContain("greet");
    expect(text).toContain("Intent<string>"); // infer fn returns Intent<T>
  });

  it("reserved *.nola.* files still error (NOLA2006 parity with build)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nola-decl-"));
    writeFileSync(join(dir, "x.nola.js"), "// squatter\n");
    writeFileSync(join(dir, "greet.tsi"), "export infer function g() {\n  return ask ..`x`<string>;\n}\n");
    const { errors } = await emitAdjacentDeclarations(dir);
    expect(errors.join("\n")).toContain("NOLA2006");
  });
});
