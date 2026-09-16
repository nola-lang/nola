import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Prompter } from "../src/flow.js";
import { runSkillInstall } from "../src/skill-install.js";

const tmp = () => mkdtemp(join(tmpdir(), "nola-skill-"));

function scripted(multiselect: (string[] | null)[]): Prompter & { notes: string[] } {
  const queue = [...multiselect];
  const notes: string[] = [];
  const unavailable = async (): Promise<never> => {
    throw new Error("unexpected prompt");
  };
  return {
    notes,
    text: unavailable,
    select: unavailable,
    confirm: unavailable,
    multiselect: async () => (queue.length > 0 ? (queue.shift() as string[] | null) : null),
    groupMultiselect: async () => {
      throw new Error("skill install has no editor half — never a grouped list");
    },
    progress: () => {
      throw new Error("skill install runs nothing long enough for a spinner");
    },
    note: (m) => {
      notes.push(m);
    },
  };
}

describe("runSkillInstall", () => {
  it("--agents writes without prompting, even non-interactively", async () => {
    const dir = await tmp();
    const code = await runSkillInstall({ dir, agents: "claude,universal,agents-md" }, { interactive: false });
    expect(code).toBe(0);
    expect(existsSync(join(dir, ".agents", "skills", "nola", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "skills", "nola", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(true);
  });

  it("interactive multiselect drives the selection", async () => {
    const dir = await tmp();
    const p = scripted([["agents-md"]]);
    const code = await runSkillInstall({ dir }, { interactive: true, prompter: p });
    expect(code).toBe(0);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(dir, ".agents"))).toBe(false);
  });

  it("cancelling the multiselect writes nothing, exit 0", async () => {
    const dir = await tmp();
    const p = scripted([null]);
    const code = await runSkillInstall({ dir }, { interactive: true, prompter: p });
    expect(code).toBe(0);
    expect(p.notes.join("\n")).toContain("Cancelled");
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });

  it("non-interactive without --agents writes nothing and exits 1 naming the flag and ids", async () => {
    const dir = await tmp();
    const p = scripted([]);
    const code = await runSkillInstall({ dir }, { interactive: false, prompter: p });
    expect(code).toBe(1);
    expect(p.notes.join("\n")).toMatch(/--agents.*claude, universal, agents-md/);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });

  it("--agents none writes nothing, exit 0", async () => {
    const dir = await tmp();
    const p = scripted([]);
    const code = await runSkillInstall({ dir, agents: "none" }, { interactive: false, prompter: p });
    expect(code).toBe(0);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });

  it("a stale copy is reported, and --force replaces it", async () => {
    const dir = await tmp();
    await mkdir(join(dir, ".agents", "skills", "nola"), { recursive: true });
    const old = "---\nname: nola\n---\n<!-- nola-skill v0.0.1 — regenerate with: nola skill install --force -->\nold\n";
    const skill = join(dir, ".agents", "skills", "nola", "SKILL.md");
    await writeFile(skill, old);

    const held = scripted([]);
    expect(await runSkillInstall({ dir, agents: "universal" }, { interactive: false, prompter: held })).toBe(0);
    expect(await readFile(skill, "utf8")).toBe(old);
    expect(held.notes.join("\n")).toContain("--force");

    const forced = scripted([]);
    expect(
      await runSkillInstall({ dir, agents: "universal", force: true }, { interactive: false, prompter: forced }),
    ).toBe(0);
    expect(await readFile(skill, "utf8")).not.toBe(old);
  });

  it("--force removes superseded stamped adapters and says so", async () => {
    const dir = await tmp();
    await mkdir(join(dir, ".cursor", "rules"), { recursive: true });
    const rule = join(dir, ".cursor", "rules", "nola.mdc");
    await writeFile(rule, "<!-- nola-skill v0.1.7 — regenerate with: nola skill install --force -->\nold\n");
    const p = scripted([]);
    expect(await runSkillInstall({ dir, agents: "universal", force: true }, { interactive: false, prompter: p })).toBe(0);
    expect(existsSync(rule)).toBe(false);
    expect(p.notes.join("\n")).toContain("Removed superseded: .cursor/rules/nola.mdc");
  });

  it("skipped notes surface (existing AGENTS.md)", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "AGENTS.md"), "# Existing\n");
    const p = scripted([]);
    const code = await runSkillInstall({ dir, agents: "agents-md" }, { interactive: false, prompter: p });
    expect(code).toBe(0);
    expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toBe("# Existing\n");
    expect(p.notes.join("\n")).toContain("AGENTS.md already exists");
  });
});
