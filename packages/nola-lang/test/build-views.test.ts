import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdBuild } from "nola-lang";
import { describe, expect, it } from "vitest";

const MODELS = "export interface Person { name: string; manager?: Person }\nexport function helper() { return 1; }\n";
const REPORT = [
  'import type { Person } from "./models.js";',
  "export infer function extract(text: string) {",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${...} in .tsi fixture source
  "  const p = ask ..`person in ${text}`<Person>;",
  "  return p;",
  "}",
  "",
].join("\n");

describe("cmdBuild with views", () => {
  it("a project with no .tsi at all still writes the view pair reached from a plain .ts root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-build-view-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(
      join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", strict: true }, include: ["src"] }),
    );
    await writeFile(join(dir, "src", "models.ts"), MODELS);
    await writeFile(join(dir, "src", "main.ts"), 'import { Person } from "./models.tsi";\nexport const s = Person.toJsonSchema();\n');
    const { written, errors, warnings } = await cmdBuild(dir, join(dir, "dist"));
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(written).toEqual([join(dir, "dist", "src", "models.tsi.js"), join(dir, "dist", "src", "models.tsi.d.ts")]);
    expect(await readFile(join(dir, "dist", "src", "models.tsi.d.ts"), "utf8")).toContain("export declare const Person:");
  });

  it("writes the view as a .tsi.js + .tsi.d.ts pair into dist beside the lowered output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-build-view-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "models.ts"), MODELS);
    await writeFile(join(dir, "src", "report.tsi"), REPORT);
    const { written, errors, warnings } = await cmdBuild(dir, join(dir, "dist"));
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    const viewJs = join(dir, "dist", "src", "models.tsi.js");
    const viewDts = join(dir, "dist", "src", "models.tsi.d.ts");
    expect(written).toContain(viewJs);
    expect(written).toContain(viewDts);
    const js = await readFile(viewJs, "utf8");
    expect(js).toContain('export * from "./models.js"');
    expect(js).toMatch(/const Person = __nola_type_Person\(\)/);
    expect(js).toContain("__nola.types.object");
    const dts = await readFile(viewDts, "utf8");
    expect(dts).toContain('export type Person = import("./models.js").Person;');
    expect(dts).toContain("export declare const Person:");
    const lowered = await readFile(join(dir, "dist", "src", "report.tsi.js"), "utf8");
    expect(lowered).toContain('from "./models.tsi"');
    expect(written.some((w) => w.includes(".nola."))).toBe(false);
  });

  it("a dangling generated view import is NOLA2007", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-build-missing-"));
    await writeFile(join(dir, "report.tsi"), REPORT.replace("./models.js", "./missing.js"));
    const { errors } = await cmdBuild(dir, join(dir, "dist"));
    expect(errors.some((e) => e.includes("NOLA2007") && e.includes("./missing.tsi"))).toBe(true);
  });
});
