// Bundles the LSP server to CJS: vscode-languageclient forks the module via
// require() semantics, and the repo floor (Node >=22.0) predates unflagged
// require(esm). Everything except `typescript` is inlined.
// The map is dev-only (--sourcemap, passed by the "bundle: editor" task).
import { rm } from "node:fs/promises";
import { build } from "esbuild";

const sourcemap = process.argv.includes("--sourcemap");

await build({
  entryPoints: ["src/server.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/server.cjs",
  external: ["typescript"],
  sourcemap,
  logLevel: "info",
});

// A stale map next to a fresh bundle would mislead the debugger — remove it.
if (!sourcemap) await rm("dist/server.cjs.map", { force: true });
