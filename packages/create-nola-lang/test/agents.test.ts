import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_IDS, defaultAgents, detectAgents, parseAgentsFlag, writeAgentSkills } from "../src/agents.js";

const tmp = () => mkdtemp(join(tmpdir(), "nola-agents-"));
const POINTER = "node_modules/nola-lang/skills/nola/SKILL.md";

describe("writeAgentSkills", () => {
  it("writes all four adapters with the node_modules pointer", async () => {
    const dir = await tmp();
    const result = await writeAgentSkills(dir, [...AGENT_IDS]);
    expect(result.wrote).toEqual([
      ".claude/skills/nola/SKILL.md",
      ".cursor/rules/nola.mdc",
      ".github/instructions/nola.instructions.md",
      "AGENTS.md",
    ]);
    expect(result.skipped).toEqual([]);
    for (const rel of result.wrote) {
      const text = await readFile(join(dir, rel), "utf8");
      expect(text, rel).toContain(POINTER);
      expect(text, rel).toContain("npm install");
    }
  });

  it("claude adapter carries name + description frontmatter", async () => {
    const dir = await tmp();
    await writeAgentSkills(dir, ["claude"]);
    const text = await readFile(join(dir, ".claude", "skills", "nola", "SKILL.md"), "utf8");
    expect(text).toMatch(/^---\n/);
    expect(text).toMatch(/^name: nola$/m);
    expect(text).toMatch(/description: /);
  });

  it("cursor adapter scopes to .tsi via globs and is not alwaysApply", async () => {
    const dir = await tmp();
    await writeAgentSkills(dir, ["cursor"]);
    const text = await readFile(join(dir, ".cursor", "rules", "nola.mdc"), "utf8");
    expect(text).toContain('globs: ["**/*.tsi", "nola.config.ts"]');
    expect(text).toContain("alwaysApply: false");
  });

  it("copilot adapter scopes via applyTo", async () => {
    const dir = await tmp();
    await writeAgentSkills(dir, ["copilot"]);
    const text = await readFile(join(dir, ".github", "instructions", "nola.instructions.md"), "utf8");
    expect(text).toContain('applyTo: "**/*.tsi"');
  });

  it("writes only the requested agents", async () => {
    const dir = await tmp();
    const result = await writeAgentSkills(dir, ["cursor"]);
    expect(result.wrote).toEqual([".cursor/rules/nola.mdc"]);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });

  it("never rewrites an existing file — skips with a note", async () => {
    const dir = await tmp();
    await mkdir(join(dir, ".cursor", "rules"), { recursive: true });
    await writeFile(join(dir, ".cursor", "rules", "nola.mdc"), "// mine\n");
    const result = await writeAgentSkills(dir, ["cursor", "copilot"]);
    expect(await readFile(join(dir, ".cursor", "rules", "nola.mdc"), "utf8")).toBe("// mine\n");
    expect(result.skipped.join("\n")).toContain(".cursor/rules/nola.mdc already exists");
    expect(result.wrote).toEqual([".github/instructions/nola.instructions.md"]);
  });

  it("an existing AGENTS.md is skipped with a paste-ready snippet in the note", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "AGENTS.md"), "# Existing\n");
    const result = await writeAgentSkills(dir, ["agents-md"]);
    expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toBe("# Existing\n");
    expect(result.wrote).toEqual([]);
    const note = result.skipped.join("\n");
    expect(note).toContain("AGENTS.md already exists");
    expect(note).toContain(POINTER); // the snippet travels in the note
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
