import { execFile } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { BUN } from "./helpers/bun.js";
import { capture, ensureBuilt } from "./helpers/ensure-built.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const NOLA = join(ROOT, "packages", "nola-lang", "dist", "main.js");
const FIXTURES = join(ROOT, "test", "e2e", "fixtures", "bun");
const hasBun = BUN !== null;

const BUNFIG = 'preload = ["@nola-lang/bun/preload"]\n\n[test]\npreload = ["@nola-lang/bun/preload"]\n';

/** Workspace-link what a copy imports; each package's own deps resolve through the junction's real path into the root node_modules. */
function linkBunDeps(app: string): void {
  const scope = join(app, "node_modules", "@nola-lang");
  mkdirSync(scope, { recursive: true });
  for (const pkg of ["runtime", "providers", "bun"]) symlinkSync(join(ROOT, "packages", pkg), join(scope, pkg), "junction");
}

/** A temp copy of an example or fixture (no node_modules/dist), linked, with the preload wired unless `preload: false`. */
async function copyOf(source: string, label: string, opts: { preload?: boolean } = {}): Promise<string> {
  const app = join(await mkdtemp(join(tmpdir(), `nola-bun-${label}-`)), "app");
  await cp(source, app, {
    recursive: true,
    filter: (p) => !p.includes(`${sep}node_modules`) && !p.includes(`${sep}dist${sep}`) && !p.endsWith(`${sep}dist`),
  });
  if (opts.preload !== false) writeFileSync(join(app, "bunfig.toml"), BUNFIG);
  linkBunDeps(app);
  return app;
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a command and resolves on ANY exit — the guard cases assert a failure's stderr. */
function runExe(file: string, args: string[], cwd: string): Promise<Run> {
  return new Promise((resolve) => {
    execFile(file, args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stdout, stderr });
    });
  });
}
const runBun = (args: string[], cwd: string) => runExe(BUN as string, args, cwd);
const lastLine = (out: string): string => out.trim().split("\n").at(-1) as string;
const nodeRun = async (entry: string, cwd: string): Promise<string> => lastLine(await capture(process.execPath, [NOLA, "run", entry], { cwd }));

// Parity is the oracle: Bun prints what Node prints. Each case runs the same temp copy under
// `nola run` (Node) and under `bun` through the preload, and compares the program's stdout.
describe.skipIf(!hasBun)("Bun (@nola-lang/bun)", () => {
  beforeAll(async () => {
    await ensureBuilt(ROOT);
  }, 600_000);

  describe.each([
    { dir: "feature-extraction", entry: "src/main.tsi", what: "two top-level asks over the replay ledger" },
    { dir: "function-calling", entry: "src/main.tsi", what: "a call intent over ./tickets.js (Bun maps it to tickets.ts)" },
    { dir: "tool-use", entry: "src/main.tsi", what: "the tool loop, three ledger turns" },
    { dir: "typescript-interop", entry: "src/main.ts", what: "a plain entry importing person.tsi" },
    { dir: "cross-file-types", entry: "src/main.ts", what: "a view: ./models.tsi of a plain module" },
  ])("examples/$dir from source — $what", ({ dir, entry }) => {
    it(`bun ${entry} prints what nola run prints`, { timeout: 180_000 }, async () => {
      const app = await copyOf(join(ROOT, "examples", dir), dir);
      const expected = await nodeRun(entry, app);
      const run = await runBun([entry], app);
      expect(run.code, run.stderr).toBe(0);
      expect(JSON.parse(lastLine(run.stdout))).toEqual(JSON.parse(expected));
    });
  });

  it("nola build output runs under bun with no plugin and no preload", { timeout: 180_000 }, async () => {
    const app = await copyOf(join(ROOT, "examples", "feature-extraction"), "dist", { preload: false });
    await capture(process.execPath, [NOLA, "build"], { cwd: app });
    const run = await runBun([join("dist", "src", "main.tsi.js")], app);
    expect(run.code, run.stderr).toBe(0);
    expect(JSON.parse(lastLine(run.stdout))).toMatchObject({ name: "Alice Smith", seniority: "staff" });
  });

  it("a throw inside a .tsi reports its SOURCE line — lines hold under Bun, columns inside an ask may drift", { timeout: 120_000 }, async () => {
    const app = await copyOf(join(FIXTURES, "positions"), "positions");
    const run = await runBun(["src/main.tsi"], app);
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain("boom after Paris");
    expect(run.stderr).toMatch(/main\.tsi:5:\d+/);
  });

  it("a throw inside an infer function body reports ONE LINE TOO HIGH — the wrapper's opener line, which no map hides under Bun", { timeout: 120_000 }, async () => {
    const app = await copyOf(join(FIXTURES, "positions"), "positions-infer");
    const run = await runBun(["src/infer.tsi"], app);
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain("boom in infer after Paris");
    // the throw is on source line 4; the docs state this limit, and this pin keeps them honest
    expect(run.stderr).toMatch(/infer\.tsi:5:\d+/);
  });

  describe("a real project shape: the extracted type reaches a second plain module (a view of a view)", () => {
    it("bun src/main.ts under the preload prints what nola run prints", { timeout: 180_000 }, async () => {
      const app = await copyOf(join(FIXTURES, "view-chain"), "view-chain");
      const expected = await nodeRun("src/main.ts", app);
      const run = await runBun(["src/main.ts"], app);
      expect(run.code, run.stderr).toBe(0);
      expect(JSON.parse(lastLine(run.stdout))).toEqual(JSON.parse(expected));
    });

    it("bun test loads it through the [test] preload", { timeout: 180_000 }, async () => {
      const app = await copyOf(join(FIXTURES, "view-chain"), "view-chain-test");
      const run = await runBun(["test"], app);
      expect(run.code, run.stderr).toBe(0);
      expect(`${run.stdout}\n${run.stderr}`).toMatch(/1 pass/);
    });

    it("Bun.build bundles it", { timeout: 180_000 }, async () => {
      const app = await copyOf(join(FIXTURES, "view-chain"), "view-chain-bundle", { preload: false });
      writeFileSync(join(app, "build.ts"), BUILD_SCRIPT);
      const expected = await nodeRun("src/main.ts", app);
      const build = await runBun(["build.ts", "src/main.ts", "bundle", "out"], app);
      expect(build.code, build.stderr).toBe(0);
      const bundle = build.stdout.trim().split("\n")[0] as string;
      const run = await runBun([bundle], app);
      expect(run.code, run.stderr).toBe(0);
      expect(JSON.parse(lastLine(run.stdout))).toEqual(JSON.parse(expected));
    });
  });

  /** A build script run BY bun: Bun.build with the plugin, printing the output paths (the bun build CLI takes no plugins). */
  const BUILD_SCRIPT = `import { nola } from "@nola-lang/bun";
const [, , entry, mode, out] = process.argv;
const result = await Bun.build({
  entrypoints: [entry],
  plugins: [nola()],
  target: mode === "browser" ? "browser" : "bun",
  ...(mode === "compile" ? { compile: { outfile: out } } : { outdir: out }),
});
for (const log of result.logs) console.error(String(log));
if (!result.success) process.exit(1);
console.log(result.outputs.map((o) => o.path).join("\\n"));
`;

  it("Bun.build({ plugins: [nola()] }) bundles .tsi from source into a runnable bundle", { timeout: 180_000 }, async () => {
    const app = await copyOf(join(ROOT, "examples", "feature-extraction"), "bundle", { preload: false });
    writeFileSync(join(app, "build.ts"), BUILD_SCRIPT);
    const expected = await nodeRun("src/main.tsi", app);
    const build = await runBun(["build.ts", "src/main.tsi", "bundle", "out"], app);
    expect(build.code, build.stderr).toBe(0);
    const bundle = build.stdout.trim().split("\n")[0] as string;
    const run = await runBun([bundle], app);
    expect(run.code, run.stderr).toBe(0);
    expect(JSON.parse(lastLine(run.stdout))).toEqual(JSON.parse(expected));
  });

  it("Bun.build bundles a view too: cross-file-types, whose report.tsi imports ./models.tsi of a plain module", { timeout: 180_000 }, async () => {
    const app = await copyOf(join(ROOT, "examples", "cross-file-types"), "bundle-view", { preload: false });
    writeFileSync(join(app, "build.ts"), BUILD_SCRIPT);
    const expected = await nodeRun("src/main.ts", app);
    const build = await runBun(["build.ts", "src/main.ts", "bundle", "out"], app);
    expect(build.code, build.stderr).toBe(0);
    const bundle = build.stdout.trim().split("\n")[0] as string;
    const run = await runBun([bundle], app);
    expect(run.code, run.stderr).toBe(0);
    expect(JSON.parse(lastLine(run.stdout))).toEqual(JSON.parse(expected));
  });

  it("Bun.build({ compile }) makes a single executable from .tsi source in one step", { timeout: 300_000 }, async () => {
    const app = await copyOf(join(ROOT, "examples", "feature-extraction"), "compile", { preload: false });
    writeFileSync(join(app, "build.ts"), BUILD_SCRIPT);
    const expected = await nodeRun("src/main.tsi", app);
    const outfile = join(app, process.platform === "win32" ? "app.exe" : "app");
    const build = await runBun(["build.ts", "src/main.tsi", "compile", outfile], app);
    expect(build.code, build.stderr).toBe(0);
    const run = await runExe(outfile, [], app);
    expect(run.code, run.stderr).toBe(0);
    expect(JSON.parse(lastLine(run.stdout))).toEqual(JSON.parse(expected));
  });

  it("bun test loads a .tsi module through the [test] preload", { timeout: 180_000 }, async () => {
    const app = await copyOf(join(FIXTURES, "bun-test"), "test");
    const run = await runBun(["test"], app);
    expect(run.code, run.stderr).toBe(0);
    expect(`${run.stdout}\n${run.stderr}`).toMatch(/1 pass/);
  });

  it("a nola.config.ts importing a .tsi is NOLA3012 before anything runs", { timeout: 120_000 }, async () => {
    const app = await copyOf(join(FIXTURES, "config-imports-tsi"), "config-guard");
    const run = await runBun(["src/main.tsi"], app);
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain("NOLA3012");
    expect(run.stdout).not.toContain("unreachable");
  });

  it("a browser-target Bun.build is NOLA4001", { timeout: 180_000 }, async () => {
    const app = await copyOf(join(ROOT, "examples", "feature-extraction"), "browser", { preload: false });
    writeFileSync(join(app, "build.ts"), BUILD_SCRIPT);
    const build = await runBun(["build.ts", "src/main.tsi", "browser", "out"], app);
    expect(build.code).not.toBe(0);
    expect(build.stderr).toContain("NOLA4001");
  });
});
