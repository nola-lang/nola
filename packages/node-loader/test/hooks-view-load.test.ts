import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { load } from "../src/hooks.js";

describe("load: view modules", () => {
  it("serves compileView output as type-stripped ESM for a ?nola-view URL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-view-load-"));
    const file = join(dir, "models.ts");
    await writeFile(file, "export interface Person { name: string }\nexport const tag = 1;\n");
    const result = await load(`${pathToFileURL(file).href}?nola-view`, {}, async () => {
      throw new Error("nextLoad must not be called for a view");
    });
    expect(result.format).toBe("module");
    const code = String(result.source);
    expect(code).toContain('export * from "./models.js"');
    expect(code).toContain("__nola_type_Person");
    // esbuild folds the value export into an export list (the name is also a type export)
    expect(code).toMatch(/const Person = __nola_type_Person\(\)/);
    expect(code).toMatch(/export (const Person|\{\s*Person\s*\})/);
    expect(code).not.toContain("interface Person"); // types stripped
    expect(code).not.toContain("export type Person");
  });

  it("a view of an unparseable source fails with the parse diagnostics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-view-load-"));
    const file = join(dir, "bad.ts");
    await writeFile(file, "const = broken(((\n");
    await expect(
      load(`${pathToFileURL(file).href}?nola-view`, {}, async () => ({ format: "module", source: "" })),
    ).rejects.toThrow(/NOLA1001/);
  });
});
