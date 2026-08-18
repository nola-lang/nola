import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdCheck } from "nola-lang";
import { describe, expect, it } from "vitest";

describe("cmdCheck", () => {
  it("passes a clean project including cross-.tsi imports", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-check-ok-"));
    await writeFile(join(dir, "lib.tsi"), "export const n = ..`n`<number>;\n");
    await writeFile(
      join(dir, "app.tsi"),
      [
        'import { n } from "./lib.tsi";',
        "export infer function go(q: string) {",
        "  const v = ask n;",
        "  return v;",
        "}",
        "",
      ].join("\n"),
    );
    const { errors } = await cmdCheck(dir);
    expect(errors).toEqual([]);
  });

  it("reports type errors mapped back to .tsi positions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-check-bad-"));
    await writeFile(
      join(dir, "bad.tsi"),
      ["export infer function go(q: string) {", "  const s: string = ask ..`n`<number>;", "  return s;", "}", ""].join(
        "\n",
      ),
    );
    const { errors } = await cmdCheck(dir);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("bad.tsi:2:9");
    expect(errors[0]).toContain("TS2322");
  });

  it("reports NOLA diagnostics before type checking", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-check-nola-"));
    await writeFile(join(dir, "top.tsi"), "const v = ask ..`v`;\n");
    const { errors } = await cmdCheck(dir);
    expect(errors.some((e) => e.includes("NOLA2001"))).toBe(true);
  });
});

describe("cmdCheck roots the project's plain .ts files (vue-tsc role)", () => {
  const TSCONFIG = JSON.stringify({
    compilerOptions: {
      strict: true,
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      allowArbitraryExtensions: true,
      noEmit: true,
      skipLibCheck: true,
    },
    include: ["src"],
  });
  const REPORT = [
    "export infer function extractName(text: string) {",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${...} in .tsi fixture source
    "  const name = ask ..`the name in ${text}`<string>;",
    "  return name;",
    "}",
    "",
  ].join("\n");

  async function project(mainTs: string, extra: Record<string, string> = {}): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "nola-check-ts-"));
    await writeFile(join(dir, "tsconfig.json"), TSCONFIG);
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "report.tsi"), REPORT);
    await writeFile(join(dir, "src", "main.ts"), mainTs);
    for (const [name, text] of Object.entries(extra)) await writeFile(join(dir, "src", name), text);
    return dir;
  }

  it("a correct main.ts importing a .tsi checks clean — no declaration files anywhere", async () => {
    const dir = await project(
      [
        'import { extractName } from "./report.tsi";',
        "export async function run(): Promise<string> {",
        '  return extractName("x");',
        "}",
        "",
      ].join("\n"),
    );
    const { errors } = await cmdCheck(dir);
    expect(errors).toEqual([]);
  });

  it("a type misuse in main.ts across the .tsi boundary fails with a positioned error", async () => {
    const dir = await project(
      [
        'import { extractName } from "./report.tsi";',
        "export async function run(): Promise<number> {",
        '  const n: number = await extractName("x");',
        "  return n;",
        "}",
        "",
      ].join("\n"),
    );
    const { errors } = await cmdCheck(dir);
    expect(errors.length).toBeGreaterThan(0);
    const err = errors.join("\n");
    expect(err).toMatch(/main\.ts:3:9 TS2322/);
  });

  it("a stale adjacent report.d.tsi.ts is not consulted — live lowered types win", async () => {
    const dir = await project(
      [
        'import { extractName } from "./report.tsi";',
        "export async function run(): Promise<string> {",
        '  return extractName("x");',
        "}",
        "",
      ].join("\n"),
      { "report.d.tsi.ts": "export declare function extractName(text: string): Promise<number>;\n" },
    );
    const { errors } = await cmdCheck(dir);
    expect(errors).toEqual([]);
  });
});
