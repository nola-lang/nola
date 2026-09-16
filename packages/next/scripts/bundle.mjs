// Bundles the Next loaders to CJS: Turbopack/webpack require() loader files,
// and our workspace (incl. the vendored parser inside @nola-lang/parser) is
// ESM — so everything except `esbuild` is inlined (typescript-plugin pattern).
import { build } from "esbuild";

for (const name of ["turbopack-loader", "client-error-loader"]) {
  const result = await build({
    entryPoints: [`src/${name}.ts`],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: `dist/${name}.cjs`,
    // derive (and the TypeScript it drives) is resolved at run time from the
    // project's dependencies: the checker must see the project's tsconfig and
    // its own installed types, and a bundled copy of TypeScript is 8 MB of dead weight.
    external: ["esbuild", "@nola-lang/derive", "typescript"],
    // The loader inlines node-loader (and, through it, the runtime): their
    // `import.meta.url` reads resolve to this file's URL instead of esbuild's empty `{}`.
    inject: ["../../scripts/esbuild/import-meta-url.js"],
    define: { "import.meta.url": "import_meta_url" },
    logLevel: "info",
  });
  if (result.warnings.length > 0) throw new Error(`esbuild reported ${result.warnings.length} warning(s)`);
}
