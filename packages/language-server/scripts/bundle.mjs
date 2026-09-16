// Bundles the LSP server to CJS: vscode-languageclient forks the module via
// require() semantics, and the repo floor (Node >=22.0) predates unflagged
// require(esm). Everything except `typescript` is inlined.
// The map is dev-only (--sourcemap, passed by the "bundle: editor" task).
import { rm } from "node:fs/promises";
import { build } from "esbuild";

const sourcemap = process.argv.includes("--sourcemap");

const result = await build({
  entryPoints: ["src/server.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/server.cjs",
  external: ["typescript"],
  // `import.meta.url` in a CJS bundle (derive's ESM fallback) resolves to this file's URL
  inject: ["../../scripts/esbuild/import-meta-url.js"],
  define: { "import.meta.url": "import_meta_url" },
  sourcemap,
  logLevel: "info",
});
// A warning here is a real defect (an inlined runtime, an empty import.meta): fail the build.
if (result.warnings.length > 0) throw new Error(`esbuild reported ${result.warnings.length} warning(s)`);

// A stale map next to a fresh bundle would mislead the debugger — remove it.
if (!sourcemap) await rm("dist/server.cjs.map", { force: true });
