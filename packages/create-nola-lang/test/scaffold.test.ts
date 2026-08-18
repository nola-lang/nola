import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scaffold } from "../src/index.js";

const tmp = () => mkdtemp(join(tmpdir(), "nola-scaffold-"));

describe("scaffold", () => {
  it("lays down the full starter into a new directory", async () => {
    const root = join(await tmp(), "my-app");
    const result = await scaffold(root);
    expect(result.root).toBe(root);
    for (const f of [
      "package.json",
      "tsconfig.json",
      "nola.config.ts",
      "nola.replay.jsonl",
      "README.md",
      ".gitignore",
      "src/person.tsi",
      "src/main.ts",
    ]) {
      expect(existsSync(join(root, f)), f).toBe(true);
    }
    // the underscore original must not leak through
    expect(existsSync(join(root, "_gitignore"))).toBe(false);
  });

  it("substitutes the project name and lockstep versions", async () => {
    const root = join(await tmp(), "my-app");
    await scaffold(root);
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    expect(pkg.name).toBe("my-app");
    const own = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.dependencies["@nola-lang/runtime"]).toBe(`^${own.version}`);
    expect(pkg.dependencies["@nola-lang/providers"]).toBe(`^${own.version}`);
    expect(pkg.devDependencies["nola-lang"]).toBe(`^${own.version}`);
    const readme = await readFile(join(root, "README.md"), "utf8");
    expect(readme).toContain("# my-app");
  });

  it("accepts an explicit name and an existing EMPTY directory", async () => {
    const root = join(await tmp(), "dir");
    await mkdir(root);
    const result = await scaffold(root, { name: "custom-name" });
    expect(result.files.length).toBeGreaterThan(0);
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    expect(pkg.name).toBe("custom-name");
  });

  it("refuses a non-empty directory", async () => {
    const root = await tmp();
    await writeFile(join(root, "existing.txt"), "hello");
    await expect(scaffold(root)).rejects.toThrow(/not empty/);
  });

  it("scaffolds the empty template", async () => {
    const root = join(await tmp(), "empty-app");
    await scaffold(root, { template: "empty" });
    for (const f of ["package.json", "tsconfig.json", "nola.config.ts", ".gitignore", "src/main.ts"]) {
      expect(existsSync(join(root, f)), f).toBe(true);
    }
    expect(existsSync(join(root, "nola.replay.jsonl"))).toBe(false);
    expect(existsSync(join(root, "src/person.tsi"))).toBe(false);
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    expect(pkg.name).toBe("empty-app");
  });

  it("rejects an unknown template", async () => {
    await expect(scaffold(join(await tmp(), "x"), { template: "nope" })).rejects.toThrow(/unknown template/);
  });

  it("scaffolds an example template from the dev checkout", async () => {
    const root = join(await tmp(), "resume-app");
    const result = await scaffold(root, { template: "extract-resume" });
    expect(result.files).toContain("src/resume.tsi");
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    expect(pkg.name).toBe("resume-app");
    const own = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.dependencies["@nola-lang/runtime"]).toBe(`^${own.version}`);
    expect(pkg.devDependencies["nola-lang"]).toBe(`^${own.version}`);
  });

  it("lists valid names in the unknown-template error", async () => {
    await expect(scaffold(join(await tmp(), "x"), { template: "nope" })).rejects.toThrow(/starter.*empty.*extract-resume/s);
  });

  it("force-clears a non-empty directory", async () => {
    const root = await tmp();
    await writeFile(join(root, "existing.txt"), "hello");
    await scaffold(root, { force: true });
    expect(existsSync(join(root, "existing.txt"))).toBe(false);
    expect(existsSync(join(root, "package.json"))).toBe(true);
  });
});
