// Bundles the Next loaders to CJS: Turbopack/webpack require() loader files,
// and our workspace (incl. the vendored parser inside @nola-lang/parser) is
// ESM — so everything except `esbuild` is inlined (typescript-plugin pattern).
import { build } from "esbuild";

for (const name of ["turbopack-loader", "client-error-loader"]) {
  await build({
    entryPoints: [`src/${name}.ts`],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: `dist/${name}.cjs`,
    external: ["esbuild"],
    logLevel: "info",
  });
}
