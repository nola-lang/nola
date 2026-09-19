import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { DEFAULT_ENTRY } from "./registry.js";

/**
 * The resolved form of the VS Code extension's own "Nola: Launch File"
 * configuration snippet, pointed at the template's real entry (src/main.ts —
 * plain .ts runs under modern Node's native type stripping; the loader
 * handles .tsi — or a one-file template's src/main.tsi, which the loader runs as
 * the entry module). resolveSourceMapLocations and skipFiles are the two
 * launch-config invariants AGENTS.md documents as mandatory for .tsi
 * debugging — keep them.
 */
const launchJson = (entry: string) => ({
  version: "0.2.0",
  configurations: [
    {
      type: "node",
      request: "launch",
      name: "Nola: Launch main",
      // ${workspaceFolder} is VS Code's own launch-config variable — it must
      // reach the file verbatim, hence the escaped dollar.
      program: `\${workspaceFolder}/${entry}`,
      runtimeArgs: ["--import", "nola-lang/register", "--enable-source-maps"],
      console: "integratedTerminal",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: VS Code variable syntax
      cwd: "${workspaceFolder}",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: VS Code variable syntax
      resolveSourceMapLocations: ["${workspaceFolder}/**", "!**/node_modules/**"],
      skipFiles: ["<node_internals>/**", "**/node_modules/**"],
    },
  ],
});

/** publisher.name of packages/vscode — resolves once the extension is on the marketplace. */
const EXTENSIONS_JSON = { recommendations: ["nola.nola-vscode"] };

export interface IdeSetupResult {
  /** project-relative posix paths written */
  wrote: string[];
  /** human-readable notes about files left untouched */
  skipped: string[];
}

/** Write .vscode/launch.json (running `entry`) + extensions.json; never rewrites an existing file. */
export async function writeVscodeSetup(targetDir: string, entry: string = DEFAULT_ENTRY): Promise<IdeSetupResult> {
  const vscodeDir = join(resolve(targetDir), ".vscode");
  await mkdir(vscodeDir, { recursive: true });
  const wrote: string[] = [];
  const skipped: string[] = [];
  const files: [name: string, content: object][] = [
    ["launch.json", launchJson(entry)],
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
