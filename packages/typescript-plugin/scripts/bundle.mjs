// Bundles the tsserver plugin to CJS: tsserver loads plugins via require(),
// and our workspace (incl. the vendored parser) is ESM — so everything except
// `typescript` is inlined. Track 3's VS Code extension points
// typescriptServerPlugins at dist/plugin.cjs.
// The map is dev-only (--sourcemap, passed by the "bundle: editor" task).
import { rm } from "node:fs/promises";
import { build } from "esbuild";

const sourcemap = process.argv.includes("--sourcemap");

await build({
  entryPoints: ["src/tsserver-entry.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/plugin.cjs",
  external: ["typescript"],
  sourcemap,
  logLevel: "info",
});

// A stale map next to a fresh bundle would mislead the debugger — remove it.
if (!sourcemap) await rm("dist/plugin.cjs.map", { force: true });
