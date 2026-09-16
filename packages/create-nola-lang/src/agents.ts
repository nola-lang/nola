import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ownVersion } from "./scaffold.js";

export type AgentId = "claude" | "universal" | "agents-md";

export const AGENT_IDS: readonly AgentId[] = ["claude", "universal", "agents-md"];

/** `nola skill install`'s agents multiselect (the scaffold asks its own gated list, see flow.ts). */
export const SKILL_AGENTS_QUESTION = "Set up coding agents? (Space toggles, Enter confirms)";

/**
 * Where each skill target writes the canonical directory (project-relative
 * posix). Claude Code reads only `.claude/skills/`; `.agents/skills/` is the
 * open Agent Skills location — "universal" in the skills CLI's vocabulary —
 * that Cursor, Copilot, Codex, Gemini CLI and most other agents read.
 */
export const SKILL_DIRS: Readonly<Record<Exclude<AgentId, "agents-md">, string>> = {
  claude: ".claude/skills/nola",
  universal: ".agents/skills/nola",
};

/** Shared option list for every agents multiselect. */
export const AGENT_OPTIONS: { value: AgentId; label: string; hint: string }[] = [
  { value: "claude", label: "Claude Code", hint: ".claude/skills/nola/ (the only directory Claude Code reads)" },
  {
    value: "universal",
    label: "Cursor, Copilot, Codex, Gemini CLI, …",
    hint: ".agents/skills/nola/ (the open Agent Skills location)",
  },
  { value: "agents-md", label: "AGENTS.md", hint: "the skill body inline, for agents that read only AGENTS.md" },
];

/**
 * The canonical skill content, resolved relative to this module — `src/` in
 * this checkout, `dist/` in the published tarball, both one level under the
 * package root (the same trick TEMPLATES_DIR uses in scaffold.ts).
 */
const SKILLS_DIR = fileURLToPath(new URL("../skills/nola/", import.meta.url));

/** Marks a generated file so staleness is detectable (spec §3). */
const STAMP_RE = /^<!-- nola-skill v(\S+)/m;
const stamp = (version: string): string =>
  `<!-- nola-skill v${version} — regenerate with: nola skill install --force -->`;

/**
 * Adapters written by 0.1.0–0.1.7 that the `.agents/skills` layout replaced
 * (spec revision 2026-09-15). Stamped ones are ours to remove under --force.
 */
const LEGACY_ADAPTERS = [".cursor/rules/nola.mdc", ".github/instructions/nola.instructions.md"] as const;

/**
 * The AGENTS.md section embeds SKILL.md's BODY verbatim, so it can never
 * drift from the skill directory (spec §2).
 */
export interface SkillSource {
  /** the frontmatter block of SKILL.md, without the --- fences */
  frontmatter: string;
  /** the first heading up to (not including) `## References` */
  body: string;
  /** the whole file, verbatim — what the skill directories copy */
  full: string;
}

export async function readSkillSource(): Promise<SkillSource> {
  const full = (await readFile(join(SKILLS_DIR, "SKILL.md"), "utf8")).replaceAll("\r\n", "\n");
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(full);
  if (!fm) throw new Error("SKILL.md is missing its frontmatter block");
  const afterFm = full.slice(fm[0].length);
  const refsAt = afterFm.indexOf("\n## References");
  const body = (refsAt === -1 ? afterFm : afterFm.slice(0, refsAt)).trim();
  return { frontmatter: fm[1] as string, body, full };
}

/** Points at the project-local copies — never node_modules (spec §1). */
const LOCAL_REFERENCES = [
  "Deeper references, when this repo has them:",
  "`.agents/skills/nola/references/` or `.claude/skills/nola/references/` —",
  "syntax.md, patterns.md, config.md, pitfalls.md.",
].join("\n");

/** The `## Nola` section for AGENTS.md — also the paste snippet when skipped. */
export function agentsSection(s: SkillSource, version: string): string {
  return ["## Nola", "", stamp(version), "", s.body, "", LOCAL_REFERENCES, ""].join("\n");
}

function agentsMd(s: SkillSource, version: string): string {
  return `# AGENTS.md\n\n${agentsSection(s, version)}`;
}

/** The interactive preselection: both skill copies, so a plain Enter covers every skills-aware agent. */
export function defaultAgents(_targetDir: string): AgentId[] {
  return ["claude", "universal"];
}

/** "all" | "none" | comma list of ids; unknown ids throw listing valid values. */
export function parseAgentsFlag(value: string): AgentId[] {
  if (value === "all") return [...AGENT_IDS];
  if (value === "none") return [];
  const ids = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const id of ids) {
    if (!AGENT_IDS.includes(id as AgentId)) {
      throw new Error(`invalid --agents "${value}" (valid: ${AGENT_IDS.join(", ")} — or all, none)`);
    }
  }
  return [...new Set(ids)] as AgentId[];
}

export interface AgentSetupResult {
  /** project-relative posix paths written */
  wrote: string[];
  /** superseded stamped adapters deleted under --force (project-relative posix paths) */
  removed: string[];
  /** human-readable notes about files left untouched */
  skipped: string[];
  /** true when something was left stale — the caller can suggest --force */
  stale: boolean;
}

export interface WriteAgentSkillsOptions {
  /** replace files stamped by another version (never touches unstamped files) */
  force?: boolean;
}

type Disposition = { write: true } | { write: false; note: string; stale: boolean };

/** Classify an existing target per spec §3. */
function disposition(path: string, existing: string, version: string, force: boolean): Disposition {
  const found = STAMP_RE.exec(existing);
  if (!found) {
    return {
      write: false,
      note: `${path} already exists and was not generated by nola — left untouched`,
      stale: false,
    };
  }
  if (found[1] === version) return { write: false, note: `${path} is up to date (v${version})`, stale: false };
  if (force) return { write: true };
  return {
    write: false,
    note: `${path} is stale (v${found[1]} → v${version}) — re-run with --force to replace it`,
    stale: true,
  };
}

/** Copy the canonical skill dir verbatim (stamp aside) into `<root>/<base>/`. */
async function writeSkillDir(root: string, base: string, s: SkillSource, version: string): Promise<string[]> {
  const dir = join(root, ...base.split("/"));
  await mkdir(join(dir, "references"), { recursive: true });
  const stamped = s.full.replace(/^(---\n[\s\S]*?\n---\n)/, `$1${stamp(version)}\n`);
  await writeFile(join(dir, "SKILL.md"), stamped);
  const wrote = [`${base}/SKILL.md`];
  for (const name of (await readdir(join(SKILLS_DIR, "references"))).sort()) {
    await writeFile(join(dir, "references", name), await readFile(join(SKILLS_DIR, "references", name), "utf8"));
    wrote.push(`${base}/references/${name}`);
  }
  return wrote;
}

/**
 * Write the selected targets as self-contained, version-stamped content.
 * Existing files are classified, never blindly overwritten (spec §3).
 */
export async function writeAgentSkills(
  targetDir: string,
  agents: AgentId[],
  opts: WriteAgentSkillsOptions = {},
): Promise<AgentSetupResult> {
  const root = resolve(targetDir);
  const version = await ownVersion();
  const source = await readSkillSource();
  const force = opts.force === true;
  const wrote: string[] = [];
  const removed: string[] = [];
  const skipped: string[] = [];
  let stale = false;

  for (const id of ["claude", "universal"] as const) {
    if (!agents.includes(id)) continue;
    const base = SKILL_DIRS[id];
    const marker = join(root, ...base.split("/"), "SKILL.md");
    if (existsSync(marker)) {
      const d = disposition(`${base}/SKILL.md`, await readFile(marker, "utf8"), version, force);
      if (!d.write) {
        skipped.push(d.note);
        stale ||= d.stale;
        continue;
      }
    }
    wrote.push(...(await writeSkillDir(root, base, source, version)));
  }

  if (agents.includes("universal")) {
    // Stamped legacy adapters are ours: superseded by .agents/skills, removed under --force.
    for (const path of LEGACY_ADAPTERS) {
      const abs = join(root, ...path.split("/"));
      if (!existsSync(abs) || !STAMP_RE.test(await readFile(abs, "utf8"))) continue;
      if (force) {
        await rm(abs);
        removed.push(path);
      } else {
        skipped.push(`${path} is superseded by .agents/skills/nola — re-run with --force to remove it`);
        stale = true;
      }
    }
  }

  if (agents.includes("agents-md")) {
    const abs = join(root, "AGENTS.md");
    if (existsSync(abs)) {
      // AGENTS.md is a user file: never modified, --force included.
      skipped.push(
        `AGENTS.md already exists — left untouched. Add this section manually:\n\n${agentsSection(source, version)}`,
      );
    } else {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, agentsMd(source, version));
      wrote.push("AGENTS.md");
    }
  }
  return { wrote, removed, skipped, stale };
}
