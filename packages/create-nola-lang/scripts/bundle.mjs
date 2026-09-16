// Bundles the package so the published manifest keeps ZERO runtime deps:
// @clack/prompts is inlined. dist/index.js is the library entry (`nola init`
// imports it through the workspace/npm install), dist/main.js the
// `npm create nola-lang` bin; splitting shares their common chunk. tsc's d.ts
// output is untouched.
import { readdir, rm } from "node:fs/promises";
import { build } from "esbuild";

// esbuild names split chunks by content hash, so an earlier bundle's chunks
// (a --dev run's, or a stale build's) survive in dist and would ship in the
// tarball. Drop them before emitting the fresh set.
for (const name of await readdir("dist").catch(() => [])) {
  if (/-[A-Z0-9]{8}\.js(\.map)?$/.test(name)) await rm(`dist/${name}`);
}

await build({
  entryPoints: ["src/index.ts", "src/main.ts"],
  bundle: true,
  splitting: true,
  platform: "node",
  format: "esm",
  outdir: "dist",
  logLevel: "info",
  sourcemap: process.argv[2] === "--dev"
});
