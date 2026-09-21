// The e2e suites each call ensureBuilt in beforeAll. Sharing a build among
// workers that wait on the same lock was not enough: a worker whose beforeAll
// started AFTER the lock was released rebuilt everything again — 21 suites,
// a handful of workers, so several full rebuilds per run — while other workers
// ran `nola build` children that import the freshly-rewritten dist. The
// create-nola-lang bundle deletes its hashed chunks before writing the new
// set, and a child caught in that window died with ERR_MODULE_NOT_FOUND on a
// chunk (publish CI, 2026-09-20). The build is now stamped with a fingerprint
// of the tree it consumed, and a caller whose tree carries the same stamp
// skips the build.
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildStamp, isBuiltFor, recordBuild, shell } from "./e2e/helpers/ensure-built.js";

describe("the e2e build stamp", () => {
  let root: string;

  async function git(args: string): Promise<void> {
    await shell(`git ${args}`, { cwd: root });
  }
  function touch(rel: string, text: string, when: number): void {
    const path = join(root, rel);
    writeFileSync(path, text);
    utimesSync(path, new Date(when), new Date(when));
  }

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "nola-e2e-stamp-"));
    for (const dir of ["packages/a/src", "scripts", "test/e2e", "examples/x"]) mkdirSync(join(root, dir), { recursive: true });
    touch("package.json", '{ "name": "fixture" }', 1_700_000_000_000);
    touch("packages/a/src/index.ts", "export const a = 1;\n", 1_700_000_000_000);
    touch("test/e2e/one.test.ts", "// test\n", 1_700_000_000_000);
    await git("init -q");
    await git('-c user.email=t@t -c user.name=t add -A');
    await git('-c user.email=t@t -c user.name=t commit -q -m init');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("is stable while nothing the build consumes has changed", () => {
    expect(buildStamp(root)).toBe(buildStamp(root));
  });

  it("a recorded build is recognized, and only for the same stamp", () => {
    expect(isBuiltFor(root, buildStamp(root))).toBe(false);
    recordBuild(root, buildStamp(root));
    expect(isBuiltFor(root, buildStamp(root))).toBe(true);
    expect(isBuiltFor(root, "something-else")).toBe(false);
  });

  it("changes when a package source, a script or a root manifest is edited (tracked or new)", () => {
    const before = buildStamp(root);
    touch("packages/a/src/index.ts", "export const a = 2;\n", 1_700_000_001_000);
    const edited = buildStamp(root);
    expect(edited).not.toBe(before);
    touch("packages/a/src/new.ts", "export const b = 1;\n", 1_700_000_002_000);
    const added = buildStamp(root);
    expect(added).not.toBe(edited);
    touch("scripts/bundle.mjs", "// build\n", 1_700_000_003_000);
    const script = buildStamp(root);
    expect(script).not.toBe(added);
    touch("package.json", '{ "name": "fixture", "x": 1 }', 1_700_000_004_000);
    expect(buildStamp(root)).not.toBe(script);
  });

  it("does NOT change when tests, examples or e2e leftovers change — the build never reads them", () => {
    const before = buildStamp(root);
    touch("test/e2e/one.test.ts", "// edited test\n", 1_700_000_001_000);
    touch("test/e2e/two.test.ts", "// new test\n", 1_700_000_002_000);
    touch("examples/x/cased-on-disk.tsi", "const x = 1;\n", 1_700_000_003_000);
    expect(buildStamp(root)).toBe(before);
  });

  it("changes when HEAD moves", async () => {
    const before = buildStamp(root);
    touch("test/e2e/one.test.ts", "// edited test\n", 1_700_000_001_000);
    await git('-c user.email=t@t -c user.name=t commit -q -am next');
    expect(buildStamp(root)).not.toBe(before);
  });
});
