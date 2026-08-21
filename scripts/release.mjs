// Version bump: `node scripts/release.mjs <version> [--npm] [--vscode] [--all]`
//
//   --npm     (default) LOCKSTEP bump: the SAME version on every packages/*
//             manifest except nola-vscode, and every internal dependency range
//             (deps + devDeps naming a workspace package) rewritten to that
//             EXACT version. Exact internal pins are load-bearing: they are what
//             guarantees npm dedupes to a single @nola-lang/runtime copy
//             (NOLA3002) — never use ^ or * here.
//   --vscode  bump the VS Code extension (packages/vscode) — its version is
//             NOT lockstep: the Marketplace rejects prerelease suffixes, so it
//             must be a plain major.minor.patch.
//   --all     both.
//
// test/publish-manifests.test.ts enforces the lockstep invariant; run
// `npm install` after a bump so the lockfile follows. Tagging/publishing is
// `node scripts/sync.mjs --release ...` (private repo tooling).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith("--"));
const flags = new Set(args.filter((a) => a.startsWith("--")));
const unknown = [...flags].filter((f) => !["--npm", "--vscode", "--all"].includes(f));
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version) || unknown.length) {
  console.error("usage: node scripts/release.mjs <semver> [--npm] [--vscode] [--all]   e.g. node scripts/release.mjs 0.1.1 --all");
  if (unknown.length) console.error(`unknown flag(s): ${unknown.join(", ")}`);
  process.exit(1);
}
const doNpm = flags.has("--npm") || flags.has("--all") || !flags.has("--vscode");
const doVscode = flags.has("--vscode") || flags.has("--all");
if (doVscode && version.includes("-")) {
  console.error(`the VS Code Marketplace rejects prerelease versions — ${version} cannot be used for --vscode`);
  process.exit(1);
}

const packagesDir = join(process.cwd(), "packages");
const manifestPaths = readdirSync(packagesDir)
  .map((d) => join(packagesDir, d, "package.json"))
  .filter((p) => {
    try {
      readFileSync(p);
      return true;
    } catch {
      return false;
    }
  });

const manifests = manifestPaths.map((path) => ({ path, json: JSON.parse(readFileSync(path, "utf8")) }));
const internalNames = new Set(manifests.map((m) => m.json.name));

// nola-vscode ships to the Marketplace — own plain version, bumped only with --vscode.
const VSCODE = "nola-vscode";

for (const { path, json } of manifests) {
  const isVscode = json.name === VSCODE;
  let changed = false;
  if (isVscode ? doVscode : doNpm) {
    json.version = version;
    changed = true;
  }
  if (doNpm) {
    for (const section of ["dependencies", "devDependencies"]) {
      for (const dep of Object.keys(json[section] ?? {})) {
        if (internalNames.has(dep)) {
          json[section][dep] = version;
          changed = true;
        }
      }
    }
  }
  if (changed) writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
  const note = isVscode
    ? doVscode
      ? `${version} (marketplace)`
      : `${json.version} (marketplace, version kept)`
    : doNpm
      ? version
      : `${json.version} (kept)`;
  console.log(`${json.name} -> ${note}`);
}

// Docs and the shipped skill quote package.json samples. Every dependency entry
// naming a workspace package is rewritten to `^<version>` — the caret range is
// what the scaffold stamps (create-nola-lang/src/scaffold.ts). Keyed on package
// NAME, so `"version": "0.0.0"` and `"typescript": "^5.6.0"` are untouchable by
// construction. test/docs-site.test.ts fails on any entry this did not reach.
if (doNpm) {
  const names = [...internalNames].map((n) => n.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|");
  const NOLA_DEP = new RegExp(`"(${names})":(\\s*)"[^"]*"`, "g");
  const walk = (dir) =>
    existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(join(dir, e.name)) : /\.mdx?$/.test(e.name) ? [join(dir, e.name)] : [],
        )
      : [];
  const roots = [join(process.cwd(), "docs-site"), join(process.cwd(), "packages", "create-nola-lang", "skills")];
  let touched = 0;
  for (const file of roots.flatMap(walk)) {
    const before = readFileSync(file, "utf8");
    const after = before.replace(NOLA_DEP, (_m, name, ws) => `"${name}":${ws}"^${version}"`);
    if (after !== before) {
      writeFileSync(file, after);
      touched++;
      console.log(`${relative(process.cwd(), file)} -> samples pinned to ^${version}`);
    }
  }
  if (touched === 0) console.log("docs-site/skill samples: already at this version");
}

console.log(`\nbumped: ${[doNpm && "npm lockstep", doVscode && "vscode"].filter(Boolean).join(" + ")} -> ${version}. Now run: npm install`);
console.log("Then commit, and publish with: node scripts/sync.mjs --release --push \"release: v<version>\"");
console.log("(the v<version> tag triggers publish-npm.yml; vscode-v<version> triggers publish-vscode.yml;");
console.log(" create-nola-lang fetches example templates from the v<version> tag.)");
