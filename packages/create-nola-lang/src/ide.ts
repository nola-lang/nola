import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * The resolved form of the VS Code extension's own "Nola: Launch File"
 * configuration snippet, pointed at the templates' real entry (src/main.ts —
 * plain .ts runs under modern Node's native type stripping; the loader
 * handles .tsi). resolveSourceMapLocations and skipFiles are the two
 * launch-config invariants AGENTS.md documents as mandatory for .tsi
 * debugging — keep them.
 */
const LAUNCH_JSON = {
  version: "0.2.0",
  configurations: [
    {
      type: "node",
      request: "launch",
      name: "Nola: Launch main",
      // ${workspaceFolder} below is VS Code's own launch-config variable —
      // deliberately a literal string, never a JS template.
      // biome-ignore lint/suspicious/noTemplateCurlyInString: VS Code variable syntax
      program: "${workspaceFolder}/src/main.ts",
      runtimeArgs: ["--import", "nola-lang/register", "--enable-source-maps"],
      console: "integratedTerminal",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: VS Code variable syntax
      cwd: "${workspaceFolder}",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: VS Code variable syntax
      resolveSourceMapLocations: ["${workspaceFolder}/**", "!**/node_modules/**"],
      skipFiles: ["<node_internals>/**", "**/node_modules/**"],
    },
  ],
};

/** publisher.name of packages/vscode — resolves once the extension is on the marketplace. */
const EXTENSIONS_JSON = { recommendations: ["nola.nola-vscode"] };

export interface IdeSetupResult {
  /** project-relative posix paths written */
  wrote: string[];
  /** human-readable notes about files left untouched */
  skipped: string[];
}

/** Write .vscode/launch.json + extensions.json; never rewrites an existing file. */
export async function writeVscodeSetup(targetDir: string): Promise<IdeSetupResult> {
  const vscodeDir = join(resolve(targetDir), ".vscode");
  await mkdir(vscodeDir, { recursive: true });
  const wrote: string[] = [];
  const skipped: string[] = [];
  const files: [name: string, content: object][] = [
    ["launch.json", LAUNCH_JSON],
    ["extensions.json", EXTENSIONS_JSON],
  ];
  for (const [name, content] of files) {
    const rel = `.vscode/${name}`;
    const path = join(vscodeDir, name);
    if (existsSync(path)) {
      skipped.push(`${rel} already exists — left untouched`);
      continue;
    }
    await writeFile(path, `${JSON.stringify(content, null, 2)}\n`);
    wrote.push(rel);
  }
  return { wrote, skipped };
}
