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

  it("rewrites Nola package samples in docs-site and the skill to ^<version>, leaving everything else alone", async () => {
    const root = await fixture();
    const sample = [
      "---",
      "title: Project anatomy",
      "---",
      "```json",
      "{",
      '  "version": "0.0.0",',
      '  "dependencies": {',
      '    "@nola-lang/providers": "0.1.3",',
      '    "@nola-lang/runtime": "0.1.3"',
      "  },",
      '  "devDependencies": {',
      '    "nola-lang": "0.1.3",',
      '    "create-nola-lang": "^0.0.1",',
      '    "typescript": "^5.6.0"',
      "  }",
      "}",
      "```",
      "",
      'Prose mentioning `@nola-lang/runtime` and "version": "9.9.9" in passing stays.',
      "",
    ].join("\n");
    await mkdir(join(root, "docs-site", "start"), { recursive: true });
    await writeFile(join(root, "docs-site", "start", "anatomy.mdx"), sample);
    const skillDir = join(root, "packages", "create-nola-lang", "skills", "nola", "references");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "config.md"), '```json\n{ "nola-lang": "^0.1.0", "typescript": "^5.6.0" }\n```\n');
    // the rewrite is keyed on WORKSPACE package names, so the fixture must declare the ones the samples name
    for (const [dir, name] of [
      ["create-nola-lang", "create-nola-lang"],
      ["nola-lang", "nola-lang"],
      ["runtime", "@nola-lang/runtime"],
      ["providers", "@nola-lang/providers"],
    ] as const) {
      await mkdir(join(root, "packages", dir), { recursive: true });
      await writeFile(join(root, "packages", dir, "package.json"), JSON.stringify({ name, version: "0.0.0" }, null, 2));
    }

    execFileSync(process.execPath, [SCRIPT, "1.2.3"], { cwd: root, encoding: "utf8" });

    const doc = await readFile(join(root, "docs-site", "start", "anatomy.mdx"), "utf8");
    expect(doc).toContain('"@nola-lang/providers": "^1.2.3"');
    expect(doc).toContain('"@nola-lang/runtime": "^1.2.3"');
    expect(doc).toContain('"nola-lang": "^1.2.3"');
    expect(doc).toContain('"create-nola-lang": "^1.2.3"');
    expect(doc).toContain('"typescript": "^5.6.0"'); // not a Nola package
    expect(doc).toContain('"version": "0.0.0"'); // the sample project's own version
    expect(doc).toContain('"version": "9.9.9"'); // prose, not a dependency entry
    expect(doc.startsWith("---\ntitle: Project anatomy\n---\n")).toBe(true); // frontmatter untouched
    const skill = await readFile(join(skillDir, "config.md"), "utf8");
    expect(skill).toContain('"nola-lang": "^1.2.3"');
    expect(skill).toContain('"typescript": "^5.6.0"');
  });

  it("rejects a non-semver argument", async () => {
    const root = await fixture();
    expect(() => execFileSync(process.execPath, [SCRIPT, "banana"], { cwd: root, encoding: "utf8" })).toThrow();
  });
});
