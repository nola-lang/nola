#!/usr/bin/env node
// Publish every public workspace package to npm, in dependency order.
//
//   node scripts/publish-npm.mjs [--dry-run] [--provenance] [--dist-tag <tag>] [--skip-build]
//
// - Public = every packages/* manifest without `private: true`
//   (test/publish-manifests.test.ts is the authority on that partition).
// - Order: topological over internal dependencies (leaves first), so a
//   consumer installing mid-publish never sees a package whose deps are absent.
// - Idempotent: a name@version already on the registry is skipped, so a
//   partially failed run can simply be re-run.
// - --dist-tag defaults to `next` for prerelease versions (0.1.0-alpha.0) and
//   `latest` otherwise — a prerelease must never become what `npm i nola-lang`
//   resolves to.
// - --provenance adds `--provenance` (GitHub Actions OIDC; needs
//   `id-token: write` and a public repo). Used by .github/workflows/publish-npm.yml.
// - Builds CLEAN by default: every packages/*/dist is deleted and `npm run build`
//   re-run before anything is packed. Packages ship dist/ as-is, and a stale
//   artifact survives `tsc -b` — a renamed module keeps its OLD file next to the
//   new one, and on a case-insensitive FS a case-only rename keeps the old
//   CASING (dist/lower/Lowerer.js for src/lower/lowerer.ts), which ships a
//   tarball that breaks on Linux and under yarn PnP. --skip-build trusts the
//   existing dist (CI: fresh checkout, already built and tested).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const dryRun = flag("dry-run");
const provenance = flag("provenance");
const skipBuild = flag("skip-build");

const packagesDir = join(ROOT, "packages");
const manifests = readdirSync(packagesDir)
  .map((d) => join(packagesDir, d, "package.json"))
  .filter((p) => {
    try {
      readFileSync(p);
      return true;
    } catch {
      return false;
    }
  })
  .map((p) => JSON.parse(readFileSync(p, "utf8")));

const publicPkgs = manifests.filter((m) => !m.private);
const version = new Set(publicPkgs.map((m) => m.version));
if (version.size !== 1) {
  console.error(`lockstep violated — public packages carry versions ${[...version].join(", ")}`);
  process.exit(1);
}
const [ver] = version;
const distTag = value("dist-tag") ?? (ver.includes("-") ? "next" : "latest");

// topological order over internal deps (dependencies only — devDeps never ship)
const names = new Set(publicPkgs.map((m) => m.name));
const byName = new Map(publicPkgs.map((m) => [m.name, m]));
const order = [];
const seen = new Set();
function visit(name, chain = []) {
  if (seen.has(name)) return;
  if (chain.includes(name)) throw new Error(`dependency cycle: ${[...chain, name].join(" → ")}`);
  const m = byName.get(name);
  for (const dep of Object.keys(m.dependencies ?? {})) if (names.has(dep)) visit(dep, [...chain, name]);
  seen.add(name);
  order.push(name);
}
for (const m of publicPkgs) visit(m.name);

if (!skipBuild) {
  console.log("clean build: removing packages/*/dist, then `npm run build`");
  for (const d of readdirSync(packagesDir)) {
    const dist = join(packagesDir, d, "dist");
    if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });
  }
  execFileSync("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
}

console.log(`publishing ${order.length} packages @ ${ver} (dist-tag ${distTag})${dryRun ? " [dry-run]" : ""}`);

let published = 0;
let skipped = 0;
for (const name of order) {
  const exists = spawnSync("npm", ["view", `${name}@${ver}`, "version", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (exists.status === 0 && exists.stdout.trim()) {
    console.log(`  = ${name}@${ver} already on the registry — skipped`);
    skipped++;
    continue;
  }
  const npmArgs = ["publish", "-w", name, "--access", "public", "--tag", distTag];
  if (provenance) npmArgs.push("--provenance");
  if (dryRun) npmArgs.push("--dry-run");
  console.log(`  → ${name}@${ver}`);
  execFileSync("npm", npmArgs, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
  published++;
}
console.log(`done: ${published} published, ${skipped} already present`);
