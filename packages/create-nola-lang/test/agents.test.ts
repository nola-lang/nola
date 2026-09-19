import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readlink, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_IDS, defaultAgents, parseAgentsFlag, readSkillSource, writeAgentSkills } from "../src/agents.js";
import { ownVersion } from "../src/scaffold.js";

const tmp = () => mkdtemp(join(tmpdir(), "nola-agents-"));
/** The pointer form these adapters replaced — no adapter may name it again. */
const LEGACY = "node_modules/nola-lang/skills/nola";
const SKILL_DIRS = [".claude/skills/nola", ".agents/skills/nola"] as const;
const REFERENCES = ["syntax.md", "patterns.md", "config.md", "pitfalls.md"] as const;
/** What `wrote` lists for the Claude Code link. */
const CLAUDE_LINK = ".claude/skills/nola → .agents/skills/nola";
const claudeDir = (dir: string) => join(dir, ".claude", "skills", "nola");

describe("writeAgentSkills", () => {
  it("claude + universal: .agents/skills holds the content and .claude/skills/nola is a relative link to it", async () => {
    const dir = await tmp();
    const version = await ownVersion();
    const result = await writeAgentSkills(dir, ["claude", "universal"]);

    // the universal directory is the one real copy…
    expect(result.wrote).toContain(".agents/skills/nola/SKILL.md");
    expect((await lstat(join(dir, ".agents", "skills", "nola"))).isDirectory()).toBe(true);
    // …and Claude Code reads it through a link whose target is relative, so the project can move
    expect(result.wrote).toContain(CLAUDE_LINK);
    expect(result.wrote.some((p) => p.startsWith(".claude/skills/nola/"))).toBe(false);
    expect((await lstat(claudeDir(dir))).isSymbolicLink()).toBe(true);
    expect((await readlink(claudeDir(dir))).replaceAll("\\", "/")).toBe("../../.agents/skills/nola");

    for (const base of SKILL_DIRS) {
      const skill = await readFile(join(dir, ...base.split("/"), "SKILL.md"), "utf8");
      expect(skill).toMatch(/^---\n/);
      expect(skill).toMatch(/^name: nola$/m);
      expect(skill).toContain(`<!-- nola-skill v${version}`);
      expect(skill).not.toContain(LEGACY);
      for (const ref of REFERENCES) {
        const copied = join(dir, ...base.split("/"), "references", ref);
        expect((await readFile(copied, "utf8")).length, `${base}/${ref} is real content`).toBeGreaterThan(1500);
      }
    }
    expect(result.skipped).toEqual([]);
    expect(result.stale).toBe(false);
    // The retired adapters are never written.
    expect(existsSync(join(dir, ".cursor"))).toBe(false);
    expect(existsSync(join(dir, ".github"))).toBe(false);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });

  it("claude alone writes a real .claude/skills copy (nothing to link to); universal alone only .agents/skills", async () => {
    const a = await tmp();
    const claude = await writeAgentSkills(a, ["claude"]);
    expect(claude.wrote.every((p) => p.startsWith(".claude/skills/nola/"))).toBe(true);
    expect((await lstat(claudeDir(a))).isDirectory()).toBe(true);
    expect(existsSync(join(a, ".agents"))).toBe(false);
    const b = await tmp();
    const universal = await writeAgentSkills(b, ["universal"]);
    expect(universal.wrote.every((p) => p.startsWith(".agents/skills/nola/"))).toBe(true);
    expect(existsSync(join(b, ".claude"))).toBe(false);
  });

  it("both copies are byte-identical", async () => {
    const dir = await tmp();
    await writeAgentSkills(dir, ["claude", "universal"]);
    for (const file of ["SKILL.md", ...REFERENCES.map((r) => `references/${r}`)]) {
      const a = await readFile(join(dir, ".agents", "skills", "nola", ...file.split("/")), "utf8");
      const b = await readFile(join(dir, ".claude", "skills", "nola", ...file.split("/")), "utf8");
      expect(a, file).toBe(b);
    }
  });

  it("AGENTS.md inlines the skill body, is stamped, and points at the project-local skill copies", async () => {
    const dir = await tmp();
    const version = await ownVersion();
    const result = await writeAgentSkills(dir, ["agents-md"]);
    expect(result.wrote).toEqual(["AGENTS.md"]);
    const text = await readFile(join(dir, "AGENTS.md"), "utf8");
    expect(text).toContain("## Nola");
    expect(text).toContain("Where Nola diverges from TypeScript");
    expect(text).toContain(`<!-- nola-skill v${version}`);
    expect(text).toContain(".agents/skills/nola/references/");
    expect(text).toContain(".claude/skills/nola/references/");
    expect(text).not.toContain(LEGACY);
    expect(existsSync(join(dir, ".agents"))).toBe(false);
  });

  it("a second run at the same version reports up to date and rewrites nothing", async () => {
    const dir = await tmp();
    await writeAgentSkills(dir, ["claude", "universal"]);
    const again = await writeAgentSkills(dir, ["claude", "universal"]);
    expect(again.wrote).toEqual([]);
    expect(again.stale).toBe(false);
    const notes = again.skipped.join("\n");
    expect(notes).toContain(".agents/skills/nola/SKILL.md is up to date");
    expect(notes).toContain(".claude/skills/nola is a link to .agents/skills/nola — up to date");
    expect((await lstat(claudeDir(dir))).isSymbolicLink()).toBe(true);
  });

  it("a claude-only copy at the current version is reported as a copy; --force turns it into the link", async () => {
    const dir = await tmp();
    const version = await ownVersion();
    await writeAgentSkills(dir, ["claude"]);
    const held = await writeAgentSkills(dir, ["claude", "universal"]);
    expect(held.wrote).toContain(".agents/skills/nola/SKILL.md");
    expect(held.wrote).not.toContain(CLAUDE_LINK);
    expect(held.stale).toBe(true);
    expect(held.skipped.join("\n")).toContain(
      `.claude/skills/nola is a copy (v${version}) — re-run with --force to replace it with a link to .agents/skills/nola`,
    );
    expect((await lstat(claudeDir(dir))).isDirectory()).toBe(true);

    const forced = await writeAgentSkills(dir, ["claude", "universal"], { force: true });
    expect(forced.wrote).toEqual([CLAUDE_LINK]);
    expect((await lstat(claudeDir(dir))).isSymbolicLink()).toBe(true);
    expect(await readFile(join(claudeDir(dir), "SKILL.md"), "utf8")).toContain(`<!-- nola-skill v${version}`);
  });

  it("a checkout without symlink support leaves the link as a plain file holding its target — repaired into a link", async () => {
    const dir = await tmp();
    await writeAgentSkills(dir, ["universal"]);
    await mkdir(join(dir, ".claude", "skills"), { recursive: true });
    await writeFile(claudeDir(dir), "../../.agents/skills/nola");
    const result = await writeAgentSkills(dir, ["claude", "universal"]);
    expect(result.wrote).toEqual([CLAUDE_LINK]);
    expect((await lstat(claudeDir(dir))).isSymbolicLink()).toBe(true);
    // a plain file that is not our link text is the user's — left alone
    const other = await tmp();
    await writeAgentSkills(other, ["universal"]);
    await mkdir(join(other, ".claude", "skills"), { recursive: true });
    await writeFile(claudeDir(other), "mine");
    const kept = await writeAgentSkills(other, ["claude", "universal"], { force: true });
    expect(kept.wrote).toEqual([]);
    expect(await readFile(claudeDir(other), "utf8")).toBe("mine");
    expect(kept.skipped.join("\n")).toContain(".claude/skills/nola already exists and was not generated by nola");
  });

  it("a link that points somewhere else is the user's; a dangling one is replaced", async () => {
    const dir = await tmp();
    await mkdir(join(dir, "elsewhere"), { recursive: true });
    await mkdir(join(dir, ".claude", "skills"), { recursive: true });
    await symlink(join("..", "..", "elsewhere"), claudeDir(dir), "dir");
    const kept = await writeAgentSkills(dir, ["claude", "universal"], { force: true });
    expect(kept.wrote).not.toContain(CLAUDE_LINK);
    expect((await readlink(claudeDir(dir))).replaceAll("\\", "/")).toBe("../../elsewhere");
    expect(kept.skipped.join("\n")).toContain(".claude/skills/nola already exists and was not generated by nola");

    const dangling = await tmp();
    await mkdir(join(dangling, ".claude", "skills"), { recursive: true });
    await symlink(join("..", "..", "gone"), claudeDir(dangling), "dir");
    const fixed = await writeAgentSkills(dangling, ["claude", "universal"]);
    expect(fixed.wrote).toContain(CLAUDE_LINK);
    expect((await readlink(claudeDir(dangling))).replaceAll("\\", "/")).toBe("../../.agents/skills/nola");
  });

  it("each copy is classified on its own — a project with only the old Claude copy gains .agents/", async () => {
    const dir = await tmp();
    await mkdir(join(dir, ".claude", "skills", "nola"), { recursive: true });
    const old = "---\nname: nola\n---\n<!-- nola-skill v0.0.1 — regenerate with: nola skill install --force -->\nold\n";
    await writeFile(join(dir, ".claude", "skills", "nola", "SKILL.md"), old);

    const held = await writeAgentSkills(dir, ["claude", "universal"]);
    expect(held.wrote).toContain(".agents/skills/nola/SKILL.md");
    expect(held.wrote).not.toContain(".claude/skills/nola/SKILL.md");
    expect(held.stale).toBe(true);
    expect(held.skipped.join("\n")).toMatch(
      /\.claude\/skills\/nola\/SKILL\.md is stale \(v0\.0\.1 → v.+\) — re-run with --force/,
    );
    expect(await readFile(join(dir, ".claude", "skills", "nola", "SKILL.md"), "utf8")).toBe(old);

    const forced = await writeAgentSkills(dir, ["claude", "universal"], { force: true });
    expect(forced.wrote).toContain(CLAUDE_LINK);
    expect(forced.wrote).not.toContain(".agents/skills/nola/SKILL.md");
    expect(await readFile(join(dir, ".claude", "skills", "nola", "SKILL.md"), "utf8")).not.toBe(old);
    expect((await lstat(claudeDir(dir))).isSymbolicLink()).toBe(true);
  });

  it("never overwrites an unstamped skill copy, even with force", async () => {
    const dir = await tmp();
    await mkdir(join(dir, ".agents", "skills", "nola"), { recursive: true });
    await writeFile(join(dir, ".agents", "skills", "nola", "SKILL.md"), "# mine\n");
    const result = await writeAgentSkills(dir, ["claude", "universal"], { force: true });
    expect(await readFile(join(dir, ".agents", "skills", "nola", "SKILL.md"), "utf8")).toBe("# mine\n");
    expect(result.wrote).not.toContain(".agents/skills/nola/SKILL.md");
    // Claude Code is linked to whatever .agents/skills/nola holds — the user's copy is the one source
    expect(result.wrote).toContain(CLAUDE_LINK);
    expect(await readFile(join(dir, ".claude", "skills", "nola", "SKILL.md"), "utf8")).toBe("# mine\n");
    expect(result.skipped.join("\n")).toContain(".agents/skills/nola/SKILL.md already exists and was not generated by nola");
  });

  it("stamped legacy adapters are superseded by the universal target, and deleted only under force", async () => {
    const dir = await tmp();
    const stamp = "<!-- nola-skill v0.1.7 — regenerate with: nola skill install --force -->";
    await mkdir(join(dir, ".cursor", "rules"), { recursive: true });
    await mkdir(join(dir, ".github", "instructions"), { recursive: true });
    const rule = join(dir, ".cursor", "rules", "nola.mdc");
    const instructions = join(dir, ".github", "instructions", "nola.instructions.md");
    await writeFile(rule, `---\nglobs: ["**/*.tsi"]\n---\n${stamp}\nold\n`);
    await writeFile(instructions, `---\napplyTo: "**/*.tsi"\n---\n${stamp}\nold\n`);

    // The claude target alone says nothing about them — they belong to the .agents/skills story.
    const claudeOnly = await writeAgentSkills(dir, ["claude"], { force: true });
    expect(claudeOnly.removed).toEqual([]);
    expect(claudeOnly.skipped.join("\n")).not.toContain("superseded");

    const held = await writeAgentSkills(dir, ["universal"]);
    expect(held.stale).toBe(true);
    const notes = held.skipped.join("\n");
    expect(notes).toMatch(/\.cursor\/rules\/nola\.mdc is superseded by \.agents\/skills\/nola.*--force/);
    expect(notes).toMatch(/\.github\/instructions\/nola\.instructions\.md is superseded by \.agents\/skills\/nola.*--force/);
    expect(existsSync(rule)).toBe(true);
    expect(existsSync(instructions)).toBe(true);

    const forced = await writeAgentSkills(dir, ["universal"], { force: true });
    expect(existsSync(rule)).toBe(false);
    expect(existsSync(instructions)).toBe(false);
    expect(forced.removed).toEqual([".cursor/rules/nola.mdc", ".github/instructions/nola.instructions.md"]);
  });

  it("an unstamped legacy path is a user file — left alone and unmentioned", async () => {
    const dir = await tmp();
    await mkdir(join(dir, ".cursor", "rules"), { recursive: true });
    await writeFile(join(dir, ".cursor", "rules", "nola.mdc"), "// mine\n");
    const result = await writeAgentSkills(dir, ["universal"], { force: true });
    expect(await readFile(join(dir, ".cursor", "rules", "nola.mdc"), "utf8")).toBe("// mine\n");
    expect(result.removed).toEqual([]);
    expect(result.skipped.join("\n")).not.toContain("nola.mdc");
  });

  it("an existing AGENTS.md is never modified — the section comes back as a paste snippet", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "AGENTS.md"), "# Existing\n");
    for (const opts of [{}, { force: true }]) {
      const result = await writeAgentSkills(dir, ["agents-md"], opts);
      expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toBe("# Existing\n");
      expect(result.wrote).toEqual([]);
      const note = result.skipped.join("\n");
      expect(note).toContain("AGENTS.md already exists");
      expect(note).toContain("## Nola");
      expect(note).toContain("Where Nola diverges from TypeScript");
    }
  });
});

describe("readSkillSource", () => {
  it("splits SKILL.md into frontmatter and the body before ## References", async () => {
    const s = await readSkillSource();
    expect(s.frontmatter).toMatch(/^name: nola$/m);
    expect(s.body).toContain("Where Nola diverges from TypeScript");
    // The references index is the skill directory's job — the inline section stops before it.
    expect(s.body).not.toContain("## References");
    expect(s.full).toContain("## References");
  });
});

describe("defaultAgents", () => {
  it("preselects both skill copies, whatever the project contains", async () => {
    const empty = await tmp();
    expect(defaultAgents(empty)).toEqual(["claude", "universal"]);
    const busy = await tmp();
    await mkdir(join(busy, ".cursor"));
    await mkdir(join(busy, ".github"));
    await writeFile(join(busy, "AGENTS.md"), "x");
    expect(defaultAgents(busy)).toEqual(["claude", "universal"]);
  });
});

describe("parseAgentsFlag", () => {
  it("parses a comma list, deduped", () => {
    expect(parseAgentsFlag("claude,universal,agents-md,claude")).toEqual(["claude", "universal", "agents-md"]);
  });
  it("all expands to every id; none to empty", () => {
    expect(parseAgentsFlag("all")).toEqual([...AGENT_IDS]);
    expect(AGENT_IDS).toEqual(["claude", "universal", "agents-md"]);
    expect(parseAgentsFlag("none")).toEqual([]);
  });
  it("rejects the retired ids like any unknown id, listing valid values", () => {
    for (const old of ["cursor", "copilot", "skills"]) {
      expect(() => parseAgentsFlag(old)).toThrow(new RegExp(`invalid --agents "${old}".*claude, universal, agents-md`));
    }
    expect(() => parseAgentsFlag("claude,emacs")).toThrow(/invalid --agents "claude,emacs".*claude, universal, agents-md/);
  });
});
