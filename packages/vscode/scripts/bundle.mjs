// Bundles the extension entry to CJS: the VS Code extension host requires()
// the main module. Everything except the `vscode` API module is inlined.
// The extension host loads THIS bundle (package.json `main`), not tsc's
// dist/extension.js — without a .cjs.map, breakpoints in src/ never bind.
// The map is dev-only (--sourcemap, passed by the "bundle: editor" task).
import { copyFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";

const sourcemap = process.argv.includes("--sourcemap");

await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/extension.cjs",
  external: ["vscode"],
  sourcemap,
  logLevel: "info",
});

// A stale map next to a fresh bundle would mislead the debugger — remove it.
if (!sourcemap) await rm("dist/extension.cjs.map", { force: true });

// The LSP server ships INSIDE the extension: an installed VSIX has no
// node_modules, so activation loads dist/server.cjs, not the package.
// (The root build bundles @nola-lang/language-server before this script runs.)
const require = createRequire(import.meta.url);
const serverSrc = require.resolve("@nola-lang/language-server/server.cjs");
await copyFile(serverSrc, "dist/server.cjs");
if (sourcemap) await copyFile(`${serverSrc}.map`, "dist/server.cjs.map").catch(() => {});
else await rm("dist/server.cjs.map", { force: true });
