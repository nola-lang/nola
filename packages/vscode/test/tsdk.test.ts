import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveTsdk } from "../src/tsdk.js";

// The old activation resolved typescript relative to the EXTENSION directory —
// fine in the monorepo (walk-up finds the hoisted root node_modules), a crash
// in an installed VSIX (nothing above ~/.vscode/extensions/...). The tsdk must
// come from the workspace when it has one, else VS Code's bundled TypeScript.

const APP_ROOT = join("C:", "vscode");
const BUILTIN = join(APP_ROOT, "extensions", "node_modules", "typescript", "lib");

function existsIn(...dirs: string[]): (path: string) => boolean {
  return (path) => dirs.some((dir) => path === join(dir, "typescript.js"));
}

describe("resolveTsdk", () => {
  it("prefers the workspace's own typescript", () => {
    const ws = join("D:", "proj");
    const wsLib = join(ws, "node_modules", "typescript", "lib");
    const tsdk = resolveTsdk({
      workspaceFolders: [ws],
      appRoot: APP_ROOT,
      exists: existsIn(wsLib, BUILTIN),
    });
    expect(tsdk).toBe(wsLib);
  });

  it("falls back to VS Code's bundled typescript when the workspace has none", () => {
    const tsdk = resolveTsdk({
      workspaceFolders: [join("D:", "proj")],
      appRoot: APP_ROOT,
      exists: existsIn(BUILTIN),
    });
    expect(tsdk).toBe(BUILTIN);
  });

  it("first workspace folder with a typescript install wins", () => {
    const a = join("D:", "a");
    const b = join("D:", "b");
    const bLib = join(b, "node_modules", "typescript", "lib");
    const tsdk = resolveTsdk({
      workspaceFolders: [a, b],
      appRoot: APP_ROOT,
      exists: existsIn(bLib, BUILTIN),
    });
    expect(tsdk).toBe(bLib);
  });

  it("returns undefined when no candidate has typescript.js", () => {
    const tsdk = resolveTsdk({
      workspaceFolders: [],
      appRoot: APP_ROOT,
      exists: () => false,
    });
    expect(tsdk).toBeUndefined();
  });
});
