import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { findProjectRoot, transformNola } from "@nola-lang/node-loader";
import { describe, expect, it } from "vitest";

describe("findProjectRoot", () => {
  it("returns the directory holding nola.config.ts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-root-"));
    await writeFile(join(dir, "nola.config.ts"), "export default {};\n");
    const child = join(dir, "src", "deep");
    await mkdir(child, { recursive: true });
    expect(findProjectRoot(child)).toBe(dir);
  });

  it("falls back to the start directory when there is no config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-noroot-"));
    expect(findProjectRoot(dir)).toBe(dir);
  });

  // A relative root would prefix-match nothing, silently re-emitting absolute paths.
  it("returns an absolute root even for a relative startDir", () => {
    expect(isAbsolute(findProjectRoot("."))).toBe(true);
  });
});

describe("transformNola sourceRoot", () => {
  const SRC = "export infer function go() {\n  const v = ask ..`value`<string>;\n  return v;\n}\n";

  it("bakes a project-root-relative path into the emitted code", async () => {
    const root = join(tmpdir(), "proj");
    const { code } = await transformNola(SRC, join(root, "src", "go.tsi"), { sourceRoot: root });
    expect(code).toContain('__nola.context.file("src/go.tsi")');
    expect(code).not.toContain(root);
  });
});
