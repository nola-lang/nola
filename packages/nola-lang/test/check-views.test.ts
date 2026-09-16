import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdCheck } from "nola-lang";
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
const CONSUMER = [
  'import { Person, helper } from "./models.tsi";',
  "export const schema = Person.toJsonSchema();",
  "export const p: Person = Person.parse({ name: String(helper()) });",
  "",
].join("\n");
const TSCONFIG = (include: string[]) =>
  JSON.stringify({
    compilerOptions: { strict: true, module: "NodeNext", moduleResolution: "NodeNext", noEmit: true, skipLibCheck: true },
    include,
  });

describe("cmdCheck with views", () => {
  it("passes a cross-file project: generated AND user-authored ./models.tsi imports resolve to the view", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-check-view-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "models.ts"), MODELS);
    await writeFile(join(dir, "src", "report.tsi"), REPORT);
    await writeFile(join(dir, "src", "consumer.ts"), CONSUMER);
    await writeFile(join(dir, "tsconfig.json"), TSCONFIG(["src"]));
    const { errors, warnings } = await cmdCheck(dir);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("a type error against a view's value is reported at the consumer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-check-view-bad-"));
    await writeFile(join(dir, "models.ts"), "export interface Person { name: string }\n");
    await writeFile(join(dir, "use.ts"), 'import { Person } from "./models.tsi";\nexport const n: number = Person;\n');
    await writeFile(join(dir, "ok.tsi"), "export const n = ..`n`<number>;\n");
    await writeFile(join(dir, "tsconfig.json"), TSCONFIG(["."]));
    const { errors } = await cmdCheck(dir);
    expect(errors.some((e) => e.includes("use.ts:2:") && e.includes("TS2322"))).toBe(true);
  });

  it("reports NOLA2007 when a .tsi specifier names nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-check-missing-"));
    await writeFile(join(dir, "report.tsi"), REPORT.replace("./models.js", "./missing.js"));
    const { errors } = await cmdCheck(dir);
    expect(errors.some((e) => e.includes("NOLA2007") && e.includes("./missing.tsi"))).toBe(true);
  });

  it("warns (non-fatal) on a same-basename .ts + .tsi pair", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-check-sibling-"));
    await writeFile(join(dir, "user.ts"), "export const u = 1;\n");
    await writeFile(join(dir, "user.tsi"), "export type User = { id: string };\n");
    const { errors, warnings } = await cmdCheck(dir);
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("user.ts");
    expect(warnings[0]).toContain("user.tsi");
    expect(warnings[0]).toContain('"./user.tsi" resolves to the Nola file');
  });
});
