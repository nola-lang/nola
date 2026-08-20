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
    note: (m) => {
      notes.push(m);
    },
  };
}

describe("runSkillInstall", () => {
  it("--agents writes without prompting, even non-interactively", async () => {
    const dir = await tmp();
    const code = await runSkillInstall({ dir, agents: "claude,agents-md" }, { interactive: false });
    expect(code).toBe(0);
    expect(existsSync(join(dir, ".claude", "skills", "nola", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(true);
  });

  it("interactive multiselect drives the selection", async () => {
    const dir = await tmp();
    const p = scripted([["cursor"]]);
    const code = await runSkillInstall({ dir }, { interactive: true, prompter: p });
    expect(code).toBe(0);
    expect(existsSync(join(dir, ".cursor", "rules", "nola.mdc"))).toBe(true);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });

  it("cancelling the multiselect writes nothing, exit 0", async () => {
    const dir = await tmp();
    const p = scripted([null]);
    const code = await runSkillInstall({ dir }, { interactive: true, prompter: p });
    expect(code).toBe(0);
    expect(p.notes.join("\n")).toContain("Cancelled");
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });

  it("non-interactive without --agents writes nothing and exits 1 naming the flag", async () => {
    const dir = await tmp();
    const p = scripted([]);
    const code = await runSkillInstall({ dir }, { interactive: false, prompter: p });
    expect(code).toBe(1);
    expect(p.notes.join("\n")).toContain("--agents");
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });

  it("--agents none writes nothing, exit 0", async () => {
    const dir = await tmp();
    const p = scripted([]);
    const code = await runSkillInstall({ dir, agents: "none" }, { interactive: false, prompter: p });
    expect(code).toBe(0);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });

  it("a stale file is reported, and --force replaces it", async () => {
    const dir = await tmp();
    await mkdir(join(dir, ".cursor", "rules"), { recursive: true });
    const old = "<!-- nola-skill v0.0.1 — regenerate with: nola skill install --force -->\nold\n";
    await writeFile(join(dir, ".cursor", "rules", "nola.mdc"), old);

    const held = scripted([]);
    expect(await runSkillInstall({ dir, agents: "cursor" }, { interactive: false, prompter: held })).toBe(0);
    expect(await readFile(join(dir, ".cursor", "rules", "nola.mdc"), "utf8")).toBe(old);
    expect(held.notes.join("\n")).toContain("--force");

    const forced = scripted([]);
    expect(
      await runSkillInstall({ dir, agents: "cursor", force: true }, { interactive: false, prompter: forced }),
    ).toBe(0);
    expect(await readFile(join(dir, ".cursor", "rules", "nola.mdc"), "utf8")).not.toBe(old);
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
