// Bundles the tsserver plugin to CJS: tsserver loads plugins via require(),
// and our workspace (incl. the vendored parser) is ESM — so everything except
// `typescript` is inlined. Track 3's VS Code extension points
// typescriptServerPlugins at dist/plugin.cjs.
// The map is dev-only (--sourcemap, passed by the "bundle: editor" task).
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const sourcemap = process.argv.includes("--sourcemap");

const result = await build({
  entryPoints: ["src/tsserver-entry.cts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/plugin.cjs",
  external: ["typescript"],
  // the parser's `charcodes` (CommonJS) as inlinable ESM constants — see scripts/esbuild/charcodes.js
  alias: { charcodes: fileURLToPath(new URL("../../../scripts/esbuild/charcodes.js", import.meta.url)) },
  // `import.meta.url` in a CJS bundle (derive's ESM fallback) resolves to this file's URL
  inject: ["../../scripts/esbuild/import-meta-url.js"],
  define: { "import.meta.url": "import_meta_url" },
  sourcemap,
  logLevel: "info",
});
// A warning here is a real defect (an inlined runtime, an empty import.meta): fail the build.
if (result.warnings.length > 0) throw new Error(`esbuild reported ${result.warnings.length} warning(s)`);

// A stale map next to a fresh bundle would mislead the debugger — remove it.
if (!sourcemap) await rm("dist/plugin.cjs.map", { force: true });
