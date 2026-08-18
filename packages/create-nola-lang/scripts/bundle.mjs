// Bundles the package so the published manifest keeps ZERO runtime deps:
// @clack/prompts is inlined. dist/index.js is the library entry (`nola init`
// imports it through the workspace/npm install), dist/main.js the
// `npm create nola-lang` bin; splitting shares their common chunk. tsc's d.ts
// output is untouched.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts", "src/main.ts"],
  bundle: true,
  splitting: true,
  platform: "node",
  format: "esm",
  outdir: "dist",
  logLevel: "info",
});
