// Extracts every `tsi` (and file-named `ts`) fence from docs-site/** into
// .tsi-check/pages/<page>/ and runs the WORKSPACE `nola check` over the whole
// tree — the guard against syntax drift between the docs and the language.
// Requires `npm run build` first. Conventions: see ./lib/tsi-fences.mjs.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFences, pageSlug, planPageFiles } from "./lib/tsi-fences.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const contentRoot = join(root, "docs-site");
const outRoot = join(root, ".tsi-check");
const pagesRoot = join(outRoot, "pages");
const nolaBin = join(root, "packages", "nola-lang", "dist", "main.js");

if (!existsSync(nolaBin)) {
  console.error(`check-docs — ${relative(root, nolaBin)} is missing; run \`npm run build\` first`);
  process.exit(1);
}

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.mdx?$/.test(name) ? [full] : [];
  });

rmSync(pagesRoot, { recursive: true, force: true });
mkdirSync(pagesRoot, { recursive: true });
writeFileSync(
  join(outRoot, "package.json"),
  JSON.stringify({ name: "tsi-check", private: true, type: "module" }, null, 2),
);
writeFileSync(
  join(outRoot, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        strict: true,
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        allowArbitraryExtensions: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ["pages"],
    },
    null,
    2,
  ),
);

// slug -> { page, files: name -> fenceLine }
const legend = new Map();
const planErrors = [];
let fileCount = 0;
for (const md of walk(contentRoot)) {
  const rel = relative(contentRoot, md).replace(/\\/g, "/");
  if (rel === "README.md") continue;
  const { files, errors } = planPageFiles(extractFences(readFileSync(md, "utf8")));
  for (const e of errors) planErrors.push(`${rel}: ${e}`);
  if (files.length === 0) continue;
  const slug = pageSlug(rel);
  const dir = join(pagesRoot, slug);
  mkdirSync(dir, { recursive: true });
  const byName = new Map();
  for (const f of files) {
    writeFileSync(join(dir, f.name), f.body.endsWith("\n") ? f.body : `${f.body}\n`);
    byName.set(f.name, f.fenceLine);
    fileCount++;
  }
  legend.set(slug, { page: rel, files: byName });
}

if (planErrors.length > 0) {
  console.error(planErrors.join("\n"));
  process.exit(1);
}
console.log(`check-docs — ${fileCount} sample file(s) from ${legend.size} page(s) written to .tsi-check/pages`);

const result = spawnSync(process.execPath, [nolaBin, "check", outRoot], { encoding: "utf8" });

// Translate `.tsi-check/pages/<slug>/<file>:line:col` back to the page + fence line.
const annotate = (text) =>
  text.replace(/pages[\\/]([\w.-]+)[\\/]([\w.-]+):(\d+):(\d+)/g, (m, slug, file, line) => {
    const entry = legend.get(slug);
    const fenceLine = entry?.files.get(file);
    return entry ? `${m}  ← docs-site/${entry.page} (fence opens at line ${fenceLine}, sample line ${line})` : m;
  });

process.stdout.write(annotate(result.stdout ?? ""));
process.stderr.write(annotate(result.stderr ?? ""));
if (result.status !== 0) {
  console.error(
    "\ncheck-docs FAILED — fix the sample or mark the fence `// not-checked` if it is deliberately invalid",
  );
  process.exit(result.status ?? 1);
}
console.log("check-docs passed");
