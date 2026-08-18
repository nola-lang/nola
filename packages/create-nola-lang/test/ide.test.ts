import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { writeVscodeSetup } from "../src/ide.js";

const tmp = () => mkdtemp(join(tmpdir(), "nola-ide-"));

describe("writeVscodeSetup", () => {
  it("writes launch.json and extensions.json into a fresh .vscode/", async () => {
    const dir = await tmp();
    const result = await writeVscodeSetup(dir);
    expect(result.wrote).toEqual([".vscode/launch.json", ".vscode/extensions.json"]);
    expect(result.skipped).toEqual([]);

    const launch = JSON.parse(await readFile(join(dir, ".vscode", "launch.json"), "utf8"));
    const cfg = launch.configurations[0];
    // biome-ignore lint/suspicious/noTemplateCurlyInString: VS Code variable syntax
    expect(cfg.program).toBe("${workspaceFolder}/src/main.ts");
    expect(cfg.runtimeArgs).toEqual(["--import", "nola-lang/register", "--enable-source-maps"]);
    expect(cfg.console).toBe("integratedTerminal");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: VS Code variable syntax
    expect(cfg.resolveSourceMapLocations).toEqual(["${workspaceFolder}/**", "!**/node_modules/**"]);
    expect(cfg.skipFiles).toEqual(["<node_internals>/**", "**/node_modules/**"]);

    const extensions = JSON.parse(await readFile(join(dir, ".vscode", "extensions.json"), "utf8"));
    expect(extensions.recommendations).toEqual(["nola.nola-vscode"]);
  });

  it("recommends exactly the extension's marketplace ID (publisher.name of packages/vscode)", async () => {
    // Derived, not pinned: renaming the publisher or extension without
    // updating the scaffold recommendation (or vice versa) must go red.
    const manifest = JSON.parse(
      await readFile(fileURLToPath(new URL("../../vscode/package.json", import.meta.url)), "utf8"),
    ) as { publisher: string; name: string };
    const dir = await tmp();
    await writeVscodeSetup(dir);
    const extensions = JSON.parse(await readFile(join(dir, ".vscode", "extensions.json"), "utf8"));
    expect(extensions.recommendations).toEqual([`${manifest.publisher}.${manifest.name}`]);
  });

  it("never rewrites an existing file — skips with a note, still writes the other", async () => {
    const dir = await tmp();
    await mkdir(join(dir, ".vscode"));
    await writeFile(join(dir, ".vscode", "launch.json"), "// mine\n");
    const result = await writeVscodeSetup(dir);
    expect(await readFile(join(dir, ".vscode", "launch.json"), "utf8")).toBe("// mine\n");
    expect(result.skipped.join("\n")).toContain(".vscode/launch.json already exists");
    expect(result.wrote).toEqual([".vscode/extensions.json"]);
    expect(existsSync(join(dir, ".vscode", "extensions.json"))).toBe(true);
  });

  it("is a no-op with notes when both files exist", async () => {
    const dir = await tmp();
    await writeVscodeSetup(dir);
    const again = await writeVscodeSetup(dir);
    expect(again.wrote).toEqual([]);
    expect(again.skipped).toHaveLength(2);
  });
});
