import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PKG = fileURLToPath(new URL("..", import.meta.url));
const SKILL_DIR = join(PKG, "skills", "nola");
const REFERENCES = ["syntax.md", "patterns.md", "config.md", "pitfalls.md"];

describe("agent skill content", () => {
  it("SKILL.md exists with name/description frontmatter", () => {
    // Normalize: an autocrlf checkout smudges the committed .md to CRLF.
    const text = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8").replaceAll("\r\n", "\n");
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    expect(fm, "frontmatter block").toBeTruthy();
    expect(fm?.[1]).toMatch(/^name: nola$/m);
    expect(fm?.[1]).toMatch(/^description: .+/m);
  });

  it("ships all four reference files and names each in SKILL.md", () => {
    const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
    for (const ref of REFERENCES) {
      expect(existsSync(join(SKILL_DIR, "references", ref)), ref).toBe(true);
      expect(skill, `SKILL.md mentions references/${ref}`).toContain(`references/${ref}`);
    }
    // No stray unreferenced files either — the set is the contract.
    expect(readdirSync(join(SKILL_DIR, "references")).sort()).toEqual([...REFERENCES].sort());
  });

  it("every reference is non-trivial (not a stub)", () => {
    for (const ref of REFERENCES) {
      const text = readFileSync(join(SKILL_DIR, "references", ref), "utf8");
      expect(text.length, `${ref} length`).toBeGreaterThan(1500);
    }
  });

  it("the tarball ships skills/", () => {
    const manifest = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")) as { files: string[] };
    expect(manifest.files).toContain("skills");
  });
});
