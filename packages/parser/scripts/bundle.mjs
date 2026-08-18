// Rebundles dist/index.js with the vendored @nola-lang/babel-parser (and its
// helpers) inlined: the fork is never published, so the published dist must be
// self-contained. Runs after `tsc -b` (which produced dist/index.d.ts and the
// babel-parser dist this bundles); only published packages stay external.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/index.js",
  external: ["@nola-lang/ast"],
  sourcemap: true,
  logLevel: "info",
});
