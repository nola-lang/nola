import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdCheck } from "nola-lang";
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

describe("cmdCheck with companions", () => {
  it("passes a cross-file project (companion served virtually)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-check-companion-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "models.ts"), MODELS);
    await writeFile(join(dir, "src", "report.tsi"), REPORT);
    const { errors } = await cmdCheck(dir);
    expect(errors).toEqual([]);
  });

  it("reports NOLA2007 when the type source is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-check-missing-"));
    await writeFile(join(dir, "report.tsi"), REPORT.replace("./models.js", "./missing.js"));
    const { errors } = await cmdCheck(dir);
    expect(errors.some((e) => e.includes("NOLA2007") && e.includes("missing"))).toBe(true);
  });

  it("reports NOLA2006 for a real file in the reserved namespace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-check-reserved-"));
    await writeFile(join(dir, "fake.nola.ts"), "export const x = 1;\n");
    await writeFile(join(dir, "ok.tsi"), "export const n = ..`n`<number>;\n");
    const { errors } = await cmdCheck(dir);
    expect(errors.some((e) => e.includes("NOLA2006") && e.includes("fake.nola.ts"))).toBe(true);
  });
});
