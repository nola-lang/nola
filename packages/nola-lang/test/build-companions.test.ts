import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdBuild } from "nola-lang";
import { describe, expect, it } from "vitest";

const MODELS = "export interface Person { name: string; manager?: Person }\n";
const REPORT = [
  'import type { Person } from "./models.js";',
  "export infer function extract(text: string) {",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${...} in .tsi fixture source
  "  const p = ask ..`person in ${text}`<Person>;",
  "  return p;",
  "}",
  "",
].join("\n");

describe("cmdBuild with companions", () => {
  it("writes companion modules into dist next to the lowered output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-build-companion-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "models.ts"), MODELS);
    await writeFile(join(dir, "src", "report.tsi"), REPORT);
    const { written, errors } = await cmdBuild(dir, join(dir, "dist"));
    expect(errors).toEqual([]);

    const companionPath = join(dir, "dist", "src", "models.nola.js");
    expect(written).toContain(companionPath);
    expect(existsSync(companionPath)).toBe(true);
    const companion = await readFile(companionPath, "utf8");
    expect(companion).toContain("__nola_type_Person as Person");
    expect(companion).toContain("__nola.types.object");

    const lowered = await readFile(join(dir, "dist", "src", "report.tsi.js"), "utf8");
    expect(lowered).toContain('from "./models.nola.js"');
  });

  it("a real file in the reserved namespace aborts the build with NOLA2006", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-build-reserved-"));
    await writeFile(join(dir, "evil.nola.ts"), "export const x = 1;\n");
    await writeFile(join(dir, "ok.tsi"), "export const n = ..`n`<number>;\n");
    const { written, errors } = await cmdBuild(dir, join(dir, "dist"));
    expect(errors.some((e) => e.includes("NOLA2006") && e.includes("evil.nola.ts"))).toBe(true);
    expect(written).toEqual([]);
  });
});
