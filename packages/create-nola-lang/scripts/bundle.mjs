// Bundles the package so the published manifest keeps ZERO runtime deps:
// @clack/prompts is inlined. dist/index.js is the library entry (`nola init`
// imports it through the workspace/npm install), dist/main.js the
// `npm create nola-lang` bin; splitting shares their common chunk. tsc's d.ts
// output is untouched.
import { readdir, rm } from "node:fs/promises";
import { basename } from "node:path";
import { build } from "esbuild";

const result = await build({
  entryPoints: ["src/index.ts", "src/main.ts"],
  bundle: true,
  splitting: true,
  platform: "node",
  format: "esm",
  outdir: "dist",
  logLevel: "info",
  metafile: true,
  sourcemap: process.argv[2] === "--dev"
});

// esbuild names split chunks by content hash, so an earlier bundle's chunks
// (a --dev run's, or a stale build's) survive in dist and would ship in the
// tarball. Drop the ones the fresh set did not write — AFTER writing it: the
// e2e suites run `nola build` children that import this dist while a rebuild
// may be in flight, and deleting first left a window in which a chunk was
// gone (ERR_MODULE_NOT_FOUND on a chunk, publish CI 2026-09-20). A chunk the
// fresh set rewrote has the same hash and the same bytes, so it never vanished.
const fresh = new Set(Object.keys(result.metafile.outputs).map((p) => basename(p)));
for (const name of await readdir("dist").catch(() => [])) {
  if (/-[A-Z0-9]{8}\.js(\.map)?$/.test(name) && !fresh.has(name)) await rm(`dist/${name}`);
}
