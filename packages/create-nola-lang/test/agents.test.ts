import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_IDS,
  defaultAgents,
  detectAgents,
  parseAgentsFlag,
  readSkillSource,
  writeAgentSkills,
} from "../src/agents.js";
import { ownVersion } from "../src/scaffold.js";

const tmp = () => mkdtemp(join(tmpdir(), "nola-agents-"));
/** The pointer form these adapters replaced — no adapter may name it again. */
const LEGACY = "node_modules/nola-lang/skills/nola";

describe("writeAgentSkills", () => {
  it("writes self-contained content for all four agents — no node_modules pointer", async () => {
    const dir = await tmp();
    const version = await ownVersion();
    const result = await writeAgentSkills(dir, [...AGENT_IDS]);

    expect(result.wrote).toContain(".claude/skills/nola/SKILL.md");
    expect(result.wrote).toContain(".cursor/rules/nola.mdc");
    expect(result.wrote).toContain(".github/instructions/nola.instructions.md");
    expect(result.wrote).toContain("AGENTS.md");
    expect(result.skipped).toEqual([]);
    expect(result.stale).toBe(false);

    for (const rel of result.wrote) {
      const text = await readFile(join(dir, rel), "utf8");
      expect(text, `${rel} must not point into node_modules`).not.toContain(LEGACY);
    }
    // The context-injected adapters carry the real rules, not an instruction to go read them.
    for (const rel of [".cursor/rules/nola.mdc", ".github/instructions/nola.instructions.md", "AGENTS.md"]) {
      const text = await readFile(join(dir, rel), "utf8");
      expect(text, `${rel} inlines the skill body`).toContain("Where Nola diverges from TypeScript");
      expect(text, `${rel} is stamped`).toContain(`<!-- nola-skill v${version}`);
    }
  });

  it("claude gets a full copy of the skill directory, references included", async () => {
    const dir = await tmp();
    await writeAgentSkills(dir, ["claude"]);
    const skill = await readFile(join(dir, ".claude", "skills", "nola", "SKILL.md"), "utf8");
    expect(skill).toMatch(/^---\n/);
    expect(skill).toMatch(/^name: nola$/m);
    expect(skill).toContain(`<!-- nola-skill v${await ownVersion()}`);
    for (const ref of ["syntax.md", "patterns.md", "config.md", "pitfalls.md"]) {
      const copied = join(dir, ".claude", "skills", "nola", "references", ref);
      expect(existsSync(copied), ref).toBe(true);
      expect((await readFile(copied, "utf8")).length, `${ref} is real content`).toBeGreaterThan(1500);
    }
  });

  it("cursor scopes to .tsi via globs; copilot via applyTo", async () => {
    const dir = await tmp();
    await writeAgentSkills(dir, ["cursor", "copilot"]);
    const mdc = await readFile(join(dir, ".cursor", "rules", "nola.mdc"), "utf8");
    expect(mdc).toContain('globs: ["**/*.tsi", "nola.config.ts"]');
    expect(mdc).toContain("alwaysApply: false");
    const instructions = await readFile(join(dir, ".github", "instructions", "nola.instructions.md"), "utf8");
    expect(instructions).toContain('applyTo: "**/*.tsi"');
  });

  it("writes only the requested agents", async () => {
    const dir = await tmp();
    const result = await writeAgentSkills(dir, ["cursor"]);
    expect(result.wrote).toEqual([".cursor/rules/nola.mdc"]);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(dir, ".claude"))).toBe(false);
  });

  it("a second run at the same version reports up to date and rewrites nothing", async () => {
    const dir = await tmp();
    await writeAgentSkills(dir, ["cursor", "claude"]);
    const again = await writeAgentSkills(dir, ["cursor", "claude"]);
    expect(again.wrote).toEqual([]);
    expect(again.stale).toBe(false);
    expect(again.skipped.join("\n")).toContain("is up to date");
  });

  it("a stale stamp is reported, and replaced only under force", async () => {
    const dir = await tmp();
    await mkdir(join(dir, ".cursor", "rules"), { recursive: true });
    const old = "<!-- nola-skill v0.0.1 — regenerate with: nola skill install --force -->\nold body\n";
    await writeFile(join(dir, ".cursor", "rules", "nola.mdc"), old);

    const held = await writeAgentSkills(dir, ["cursor"]);
    expect(held.wrote).toEqual([]);
    expect(held.stale).toBe(true);
    expect(held.skipped.join("\n")).toMatch(/is stale \(v0\.0\.1 → v.+\) — re-run with --force/);
    expect(await readFile(join(dir, ".cursor", "rules", "nola.mdc"), "utf8")).toBe(old);

    const forced = await writeAgentSkills(dir, ["cursor"], { force: true });
    expect(forced.wrote).toEqual([".cursor/rules/nola.mdc"]);
    expect(await readFile(join(dir, ".cursor", "rules", "nola.mdc"), "utf8")).not.toBe(old);
  });

  // The shipped 0.1.0–0.1.3 adapters predate stamping, so the real-world
  // legacy file carries NO stamp — it must still be recognized, not mistaken
  // for a user-authored file.
  it("an unstamped legacy pointer adapter is recognized as superseded and upgradable", async () => {
    const dir = await tmp();
    await mkdir(join(dir, ".cursor", "rules"), { recursive: true });
    await writeFile(
      join(dir, ".cursor", "rules", "nola.mdc"),
      `---\napplyTo: "**/*.tsi"\n---\n\nRead \`${LEGACY}/SKILL.md\` before writing .tsi files.\n`,
    );
    const held = await writeAgentSkills(dir, ["cursor"]);
    expect(held.stale).toBe(true);
    expect(held.skipped.join("\n")).toContain("superseded pointer form");

    const forced = await writeAgentSkills(dir, ["cursor"], { force: true });
    expect(forced.wrote).toEqual([".cursor/rules/nola.mdc"]);
    expect(await readFile(join(dir, ".cursor", "rules", "nola.mdc"), "utf8")).not.toContain(LEGACY);
  });

  it("never overwrites an unstamped file, even with force", async () => {
    const dir = await tmp();
    await mkdir(join(dir, ".cursor", "rules"), { recursive: true });
    await writeFile(join(dir, ".cursor", "rules", "nola.mdc"), "// mine\n");
    const result = await writeAgentSkills(dir, ["cursor"], { force: true });
    expect(await readFile(join(dir, ".cursor", "rules", "nola.mdc"), "utf8")).toBe("// mine\n");
    expect(result.wrote).toEqual([]);
    expect(result.skipped.join("\n")).toContain("was not generated by nola");
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
    // The references index is the claude adapter's job — inline adapters stop before it.
    expect(s.body).not.toContain("## References");
    expect(s.full).toContain("## References");
  });
});

describe("detectAgents / defaultAgents", () => {
  it("detects nothing in an empty dir; default is agents-md alone", async () => {
    const dir = await tmp();
    expect(detectAgents(dir)).toEqual([]);
    expect(defaultAgents(dir)).toEqual(["agents-md"]);
  });

  it("detects claude via .claude/ or CLAUDE.md", async () => {
    const a = await tmp();
    await mkdir(join(a, ".claude"));
    expect(detectAgents(a)).toEqual(["claude"]);
    const b = await tmp();
    await writeFile(join(b, "CLAUDE.md"), "x");
    expect(detectAgents(b)).toEqual(["claude"]);
  });

  it("detects cursor via .cursor/ and copilot via .github/", async () => {
    const dir = await tmp();
    await mkdir(join(dir, ".cursor"));
    await mkdir(join(dir, ".github"));
    expect(detectAgents(dir)).toEqual(["cursor", "copilot"]);
    expect(defaultAgents(dir)).toEqual(["cursor", "copilot", "agents-md"]);
  });

  it("a nonexistent dir detects nothing", () => {
    expect(detectAgents(join("definitely", "not", "here"))).toEqual([]);
  });
});

describe("parseAgentsFlag", () => {
  it("parses a comma list, deduped", () => {
    expect(parseAgentsFlag("claude,cursor,claude")).toEqual(["claude", "cursor"]);
  });
  it("all expands to every id; none to empty", () => {
    expect(parseAgentsFlag("all")).toEqual([...AGENT_IDS]);
    expect(parseAgentsFlag("none")).toEqual([]);
  });
  it("rejects an unknown id listing valid values", () => {
    expect(() => parseAgentsFlag("claude,emacs")).toThrow(/invalid --agents "claude,emacs".*claude.*agents-md/);
  });
});
