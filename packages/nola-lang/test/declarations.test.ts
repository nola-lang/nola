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

  it("writes <base>.d.tsi.ts next to every VIEWED plain module too", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nola-decl-"));
    writeFileSync(join(dir, "models.ts"), "export interface Person { name: string }\n");
    writeFileSync(join(dir, "report.tsi"), 'import type { Person } from "./models.js";\nexport const p = ..`p`<Person>;\n');
    const { written, errors } = await emitAdjacentDeclarations(dir);
    expect(errors).toEqual([]);
    expect(written).toContain(join(dir, "report.d.tsi.ts"));
    expect(written).toContain(join(dir, "models.d.tsi.ts"));
    expect(readFileSync(join(dir, "models.d.tsi.ts"), "utf8")).toContain("export declare const Person:");
  });

  it("a project with no .tsi at all: a view reached only from a plain .ts root gets its declaration", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nola-decl-"));
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", strict: true }, include: ["."] }),
    );
    writeFileSync(join(dir, "models.ts"), "export interface Person { name: string }\n");
    writeFileSync(join(dir, "main.ts"), 'import { Person } from "./models.tsi";\nexport const s = Person.toJsonSchema();\n');
    const { written, errors } = await emitAdjacentDeclarations(dir);
    expect(errors).toEqual([]);
    expect(written).toEqual([join(dir, "models.d.tsi.ts")]);
    expect(readFileSync(join(dir, "models.d.tsi.ts"), "utf8")).toContain("export declare const Person:");
  });
});
