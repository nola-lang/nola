import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scaffold } from "../src/index.js";
import { templateNames } from "../src/registry.js";
import { withRecommendedGitignore } from "../src/scaffold.js";

const tmp = () => mkdtemp(join(tmpdir(), "nola-scaffold-"));

describe("scaffold", () => {
  it("lays down feature-extraction (the default): ONE src/main.tsi that is the program, plus the ledger", async () => {
    const root = join(await tmp(), "my-app");
    const result = await scaffold(root);
    expect(result.root).toBe(root);
    expect(result.files).toEqual([
      ".gitignore",
      "README.md",
      "nola.config.ts",
      "nola.replay.jsonl",
      "package.json",
      "src/main.tsi",
      "tsconfig.json",
    ]);
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    expect(pkg.scripts.start).toBe("nola run src/main.tsi");
    const main = await readFile(join(root, "src/main.tsi"), "utf8");
    expect(main).not.toContain("__NEXT_STEPS__");
    // the three scope-body constructs the template exists to show
    expect(main).toMatch(/^\/\/ Next steps/); // the comment leads; the instruction literal is still the first STATEMENT
    expect(main).toContain("const .message =");
    expect(main).toMatch(/^const \w+ = ask `/m); // a top-level ask in the implied-sigil spelling
    expect(main).toContain("console.log(");
    expect(main).not.toContain("infer function");
  });

  it("lays down function-calling: src/main.tsi with a call intent over an async function in src/tickets.ts", async () => {
    const root = join(await tmp(), "fc");
    const result = await scaffold(root, { template: "function-calling" });
    expect(result.files).toEqual([
      ".gitignore",
      "README.md",
      "nola.config.ts",
      "nola.replay.jsonl",
      "package.json",
      "src/main.tsi",
      "src/tickets.ts",
      "tsconfig.json",
    ]);
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    expect(pkg.scripts.start).toBe("nola run src/main.tsi");
    const main = await readFile(join(root, "src/main.tsi"), "utf8");
    expect(main).not.toContain("__NEXT_STEPS__");
    expect(main).toContain('import { createTicket } from "./tickets.js";');
    expect(main).toContain("const .message =");
    expect(main).toMatch(/^const \w+ = ask createTicket\(\.\./m);
    expect(main).not.toContain("infer function");
    const tickets = await readFile(join(root, "src/tickets.ts"), "utf8");
    expect(tickets).toContain("export async function createTicket(");
  });

  it("lays down the full typescript-interop template into a new directory", async () => {
    const root = join(await tmp(), "my-app");
    const result = await scaffold(root, { template: "typescript-interop" });
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

  it("renders the VS Code next steps into the entry file when the editor was chosen", async () => {
    const entries = {
      "feature-extraction": "src/main.tsi",
      "function-calling": "src/main.tsi",
      "typescript-interop": "src/main.ts",
      empty: "src/main.ts",
    };
    const breakpointIn = {
      "feature-extraction": "the `ask` line below",
      "function-calling": "the `ask` line below",
      "typescript-interop": "src/person.tsi",
      empty: "your .tsi file",
    };
    for (const [template, entry] of Object.entries(entries)) {
      const root = join(await tmp(), template);
      await scaffold(root, { template, ide: "vscode" });
      const main = await readFile(join(root, entry), "utf8");
      expect(main, template).not.toContain("__NEXT_STEPS__");
      expect(main, template).toMatch(/^\/\/ Next steps in VS Code/);
      expect(main, template).toContain("F5");
      expect(main, template).toContain("breakpoint");
      expect(main, template).toContain("recommended");
      expect(main, template).toContain(breakpointIn[template as keyof typeof breakpointIn]);
    }
  });

  it("renders editor-neutral next steps into the entry file without an editor", async () => {
    const root = join(await tmp(), "plain");
    await scaffold(root);
    const main = await readFile(join(root, "src/main.tsi"), "utf8");
    expect(main).not.toContain("__NEXT_STEPS__");
    expect(main).toMatch(/^\/\/ Next steps/);
    expect(main).not.toContain("F5");
    expect(main).toContain("https://nola.sh/docs/start/editor-setup/");
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

  it("writes the recommended .gitignore for EVERY template in the menu", async () => {
    for (const template of templateNames()) {
      const root = join(await tmp(), template);
      const result = await scaffold(root, { template });
      expect(result.files, template).toContain(".gitignore");
      const lines = (await readFile(join(root, ".gitignore"), "utf8")).split("\n");
      expect(lines, template).toEqual(
        expect.arrayContaining(["node_modules/", "dist/", "*.tsbuildinfo", "*.d.tsi.ts", ".env", ".env.*", "!.env.example"]),
      );
      expect(existsSync(join(root, "_gitignore")), template).toBe(false);
    }
  });

  it("keeps a .gitignore the template carries itself", async () => {
    const own = new Map([[".gitignore", "custom/\n"]]);
    expect(await withRecommendedGitignore(own)).toBe(own);
    expect(own.get(".gitignore")).toBe("custom/\n");
  });

  it("lists valid names in the unknown-template error", async () => {
    await expect(scaffold(join(await tmp(), "x"), { template: "nope" })).rejects.toThrow(/feature-extraction.*function-calling.*typescript-interop.*empty.*extract-resume/s);
  });

  it("force-clears a non-empty directory", async () => {
    const root = await tmp();
    await writeFile(join(root, "existing.txt"), "hello");
    await scaffold(root, { force: true });
    expect(existsSync(join(root, "existing.txt"))).toBe(false);
    expect(existsSync(join(root, "package.json"))).toBe(true);
  });
});
