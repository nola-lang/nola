import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../scripts/release.mjs", import.meta.url));

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nola-release-"));
  await mkdir(join(root, "packages", "a"), { recursive: true });
  await mkdir(join(root, "packages", "b"), { recursive: true });
  await writeFile(
    join(root, "packages", "a", "package.json"),
    JSON.stringify({ name: "@scope/a", version: "0.0.0" }, null, 2),
  );
  await writeFile(
    join(root, "packages", "b", "package.json"),
    JSON.stringify(
      {
        name: "@scope/b",
        version: "0.0.0",
        dependencies: { "@scope/a": "*", "left-pad": "^1.0.0" },
        devDependencies: { "@scope/a": "0.0.0" },
      },
      null,
      2,
    ),
  );
  return root;
}

describe("scripts/release.mjs", () => {
  it("sets the lockstep version and pins internal refs exactly, leaving external ranges alone", async () => {
    const root = await fixture();
    execFileSync(process.execPath, [SCRIPT, "1.2.3"], { cwd: root, encoding: "utf8" });
    const a = JSON.parse(await readFile(join(root, "packages", "a", "package.json"), "utf8"));
    const b = JSON.parse(await readFile(join(root, "packages", "b", "package.json"), "utf8"));
    expect(a.version).toBe("1.2.3");
    expect(b.version).toBe("1.2.3");
    expect(b.dependencies["@scope/a"]).toBe("1.2.3");
    expect(b.devDependencies["@scope/a"]).toBe("1.2.3");
    expect(b.dependencies["left-pad"]).toBe("^1.0.0");
  });

  it("rejects a non-semver argument", async () => {
    const root = await fixture();
    expect(() => execFileSync(process.execPath, [SCRIPT, "banana"], { cwd: root, encoding: "utf8" })).toThrow();
  });
});
