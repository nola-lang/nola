// Rebundles dist/index.js with the vendored @nola-lang/babel-parser (and its
// helpers) inlined: the fork is never published, so the published dist must be
// self-contained. Runs after `tsc -b` (which produced dist/index.d.ts and the
// babel-parser dist this bundles); only published packages stay external.
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const result = await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/index.js",
  external: ["@nola-lang/ast"],
  // The fork's `charcodes` (CommonJS) would be wrapped in getters — a function
  // call per character in the tokenizer; the ESM shim's constants inline instead.
  alias: { charcodes: fileURLToPath(new URL("../../../scripts/esbuild/charcodes.js", import.meta.url)) },
  sourcemap: true,
  logLevel: "info",
});
// A warning here is a real defect (a `charCodes.x` the shim lacks reads as undefined): fail the build.
if (result.warnings.length > 0) throw new Error(`esbuild reported ${result.warnings.length} warning(s)`);
