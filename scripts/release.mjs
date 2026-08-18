// Lockstep version bump: `node scripts/release.mjs <version>` sets the SAME
// version on every packages/* manifest and rewrites every internal dependency
// range (deps + devDeps naming a workspace package) to that EXACT version.
// Exact internal pins are load-bearing: they are what guarantees npm dedupes
// to a single @nola-lang/runtime copy (NOLA3002) — never use ^ or * here.
// test/publish-manifests.test.ts enforces the invariant; run `npm install`
// after a bump so the lockfile follows.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("usage: node scripts/release.mjs <semver>   e.g. node scripts/release.mjs 0.1.0");
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

// nola-vscode ships to the Marketplace, which rejects prerelease suffixes —
// it keeps its own plain major.minor.patch version; only its internal pins follow.
const LOCKSTEP_EXEMPT = new Set(["nola-vscode"]);

for (const { path, json } of manifests) {
  const exempt = LOCKSTEP_EXEMPT.has(json.name);
  if (!exempt) json.version = version;
  for (const section of ["dependencies", "devDependencies"]) {
    for (const dep of Object.keys(json[section] ?? {})) {
      if (internalNames.has(dep)) json[section][dep] = version;
    }
  }
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`${json.name} -> ${exempt ? `${json.version} (marketplace, version kept)` : version}`);
}

console.log(`\n${manifests.length} manifests set to ${version}. Now run: npm install`);
console.log(`\nAfter committing: tag v${version} on github.com/nola-lang/nola — that tag triggers`);
console.log(".github/workflows/publish-npm.yml (npm publish + GitHub release), and");
console.log("create-nola-lang fetches example templates from it.");
