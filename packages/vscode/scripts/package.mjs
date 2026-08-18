// Assembles a self-contained VSIX. The extension needs two things an installed
// copy cannot resolve from the monorepo's workspace symlinks:
//   - dist/server.cjs (the LSP server; bundle.mjs copies it into dist), and
//   - node_modules/@nola-lang/typescript-plugin (tsserver resolves the plugin
//     from the EXTENSION's node_modules; its dist/plugin.cjs is self-contained
//     with `typescript` external).
// A staging directory is the whitelist: only what's copied here ships, so vsce
// ignore semantics never decide what lands in the VSIX. Run after `npm run build`.
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const staging = join(pkgDir, ".vsix-staging");

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

// The staged manifest is the real one minus repo-only fields: nothing installs
// or builds inside the VSIX, and `private` only marks the npm publish partition.
// The tsserver plugin stays the ONE declared dependency — vsce's dependency
// walk (npm list over the staged node_modules) is the only route that puts
// files under node_modules into a VSIX; --no-dependencies hard-excludes them,
// .vscodeignore negations included.
const manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
delete manifest.private;
delete manifest.scripts;
delete manifest.devDependencies;
manifest.dependencies = { "@nola-lang/typescript-plugin": "*" };
writeFileSync(join(staging, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

for (const file of ["README.md", "LICENSE", "CHANGELOG.md"]) {
  cpSync(join(pkgDir, file), join(staging, file));
}
for (const dir of ["language", "media"]) {
  cpSync(join(pkgDir, dir), join(staging, dir), { recursive: true });
}
for (const file of ["dist/extension.cjs", "dist/server.cjs"]) {
  cpSync(join(pkgDir, file), join(staging, file));
}

// The tsserver plugin: manifest (its top-level `main` is what tsserver's
// classic resolver reads) + the self-contained bundle. Resolved through the
// package's own entry point — `./package.json` is not an exported subpath.
const require = createRequire(join(pkgDir, "package.json"));
const pluginEntry = require.resolve("@nola-lang/typescript-plugin");
const pluginDir = dirname(dirname(pluginEntry)); // <plugin>/dist/plugin.cjs -> <plugin>
const stagedPlugin = join(staging, "node_modules", "@nola-lang", "typescript-plugin");
for (const file of ["LICENSE", "dist/plugin.cjs"]) {
  cpSync(join(pluginDir, file), join(stagedPlugin, file));
}
// The bundle inlines the plugin's deps — strip them so npm's tree walk in the
// staging dir (no install ran there) sees nothing missing.
const pluginManifest = JSON.parse(readFileSync(join(pluginDir, "package.json"), "utf8"));
delete pluginManifest.dependencies;
delete pluginManifest.devDependencies;
writeFileSync(join(stagedPlugin, "package.json"), `${JSON.stringify(pluginManifest, null, 2)}\n`);

const out = join(pkgDir, `nola-vscode-${manifest.version}.vsix`);
const listing = execSync(`npx --no-install vsce package -o "${out}"`, {
  cwd: staging,
  encoding: "utf8",
});
process.stdout.write(listing);
if (!listing.includes("plugin.cjs")) {
  throw new Error(
    "VSIX is missing node_modules/@nola-lang/typescript-plugin — vsce stopped honoring the .vscodeignore negation; tsserver would silently lose .tsi support.",
  );
}
console.log(`\nVSIX written to ${out}`);
