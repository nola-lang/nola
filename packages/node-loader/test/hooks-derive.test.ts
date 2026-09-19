import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { initialize, load } from "../src/hooks.js";

async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nola-hooks-derive-"));
  await writeFile(join(dir, "nola.config.ts"), "export default {};\n");
  await mkdir(join(dir, "src"), { recursive: true });
  for (const [rel, text] of Object.entries(files)) await writeFile(join(dir, rel), text);
  return dir;
}

const nextLoad = async () => {
  throw new Error("nextLoad must not be called for a .tsi");
};

describe("load: checker-backed derivation (emit 15)", () => {
  it("a .tsi's accessors carry checker-derived bodies — Partial<T> flattens; no inert body survives", async () => {
    const dir = await project({
      "src/p.tsi": "export type P = Partial<{ a: string; b: number }>;\nconst i = ..`x`<P>;\n",
    });
    initialize({ compiler: { underivableContextType: "error" } });
    const result = await load(pathToFileURL(join(dir, "src/p.tsi")).href, {}, nextLoad);
    const code = String(result.source);
    expect(code).toContain(
      "__nola.types.object({ a: __nola.types.optional(__nola.types.string()), b: __nola.types.optional(__nola.types.number()) })",
    );
    expect(code).toContain('__nola.types.ref("P", __nola_type_P)');
    expect(code).not.toContain("undefined as never");
    expect(code).not.toContain("void 0"); // esbuild's spelling of the inert body
  });

  it("a view served for ?nola-view has derived bodies too", async () => {
    const dir = await project({ "src/models.ts": 'export interface Q { k: "a" | "b"; n?: number }\n' });
    const result = await load(`${pathToFileURL(join(dir, "src/models.ts")).href}?nola-view`, {}, nextLoad);
    const code = String(result.source);
    // the compiler's own text: Node's strip mode never reprints it (esbuild used to space the array)
    expect(code).toContain('__nola.types.object({ k: __nola.types.enum(["a","b"]), n: __nola.types.optional(__nola.types.number()) })');
    expect(code).toMatch(/const Q = __nola_type_Q\(\)/);
  });

  it("an underivable extractor type fails the load with NOLA2002", async () => {
    const dir = await project({ "src/bad.tsi": "const i = ..`x`<Map<string, number>>;\n" });
    await expect(load(pathToFileURL(join(dir, "src/bad.tsi")).href, {}, nextLoad)).rejects.toThrow(/NOLA2002/);
  });
});
