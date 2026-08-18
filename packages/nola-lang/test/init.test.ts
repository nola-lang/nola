import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cmdInit } from "../src/init.js";

describe("nola init", () => {
  it("scaffolds the same starter as npm create nola-lang", async () => {
    const root = join(await mkdtemp(join(tmpdir(), "nola-init-")), "my-app");
    const code = await cmdInit(root, {});
    expect(code).toBe(0);
    for (const f of ["package.json", "nola.config.ts", "nola.replay.jsonl", ".gitignore", "src/person.tsi", "src/main.ts"]) {
      expect(existsSync(join(root, f)), f).toBe(true);
    }
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    expect(pkg.name).toBe("my-app");
    expect(pkg.devDependencies["nola-lang"]).toBeDefined();
  });

  it("fails with a message on a non-empty target", async () => {
    const root = await mkdtemp(join(tmpdir(), "nola-init-"));
    await cmdInit(root, {}); // first scaffold fills it
    await expect(cmdInit(root, {})).rejects.toThrow(/not empty/);
  });

  it("scaffolds a chosen template non-interactively via --template", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "nola-init-t-")), "app");
    const code = await cmdInit(dir, { template: "empty" });
    expect(code).toBe(0);
    expect(existsSync(join(dir, "nola.config.ts"))).toBe(true);
    expect(existsSync(join(dir, "nola.replay.jsonl"))).toBe(false);
  });

  it("adds Nola to an existing project via --add", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-init-add-"));
    await writeFile(join(dir, "package.json"), '{"name":"existing"}\n');
    const code = await cmdInit(dir, { add: true });
    expect(code).toBe(0);
    expect(existsSync(join(dir, "nola.config.ts"))).toBe(true);
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(pkg.dependencies["@nola-lang/runtime"]).toBeDefined();
  });

  it("scaffolds with the VS Code setup via --ide vscode", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "nola-init-ide-")), "app");
    const code = await cmdInit(dir, { template: "empty", ide: "vscode" });
    expect(code).toBe(0);
    expect(existsSync(join(dir, ".vscode", "launch.json"))).toBe(true);
    expect(existsSync(join(dir, ".vscode", "extensions.json"))).toBe(true);
  });
});
