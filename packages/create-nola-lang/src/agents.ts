import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ownVersion } from "./scaffold.js";

export type AgentId = "claude" | "cursor" | "copilot" | "agents-md";

export const AGENT_IDS: readonly AgentId[] = ["claude", "cursor", "copilot", "agents-md"];

/** Shared option list for every "Set up coding agents?" multiselect. */
export const AGENT_OPTIONS: { value: AgentId; label: string; hint: string }[] = [
  { value: "agents-md", label: "AGENTS.md", hint: "cross-agent instructions (Codex, Gemini CLI, …)" },
  { value: "claude", label: "Claude Code", hint: ".claude/skills/nola/ (full skill + references)" },
  { value: "cursor", label: "Cursor", hint: ".cursor/rules/nola.mdc" },
  { value: "copilot", label: "GitHub Copilot", hint: ".github/instructions/nola.instructions.md" },
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

/** Pointer-era adapters (0.1.0–0.1.3) named this path; they are superseded. */
const LEGACY_MARKER = "node_modules/nola-lang/skills/nola";

/**
 * Adapters that inject context inline embed SKILL.md's BODY verbatim, so no
 * adapter restates the language rules in its own words and the four can
 * never drift from each other (spec §2).
 */
export interface SkillSource {
  /** the frontmatter block of SKILL.md, without the --- fences */
  frontmatter: string;
  /** the first heading up to (not including) `## References` */
  body: string;
  /** the whole file, verbatim — what the claude adapter copies */
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

/** Points at the project-local copy — never node_modules (spec §1). */
const LOCAL_REFERENCES = [
  "Deeper references, when this repo has them:",
  "`.claude/skills/nola/references/` — syntax.md, patterns.md, config.md,",
  "pitfalls.md.",
].join("\n");

function cursorRule(s: SkillSource, version: string): string {
  return [
    "---",
    "description: Nola (.tsi) language rules",
    'globs: ["**/*.tsi", "nola.config.ts"]',
    "alwaysApply: false",
    "---",
    stamp(version),
    "",
    s.body,
    "",
    LOCAL_REFERENCES,
    "",
  ].join("\n");
}

function copilotInstructions(s: SkillSource, version: string): string {
  return ["---", 'applyTo: "**/*.tsi"', "---", stamp(version), "", s.body, "", LOCAL_REFERENCES, ""].join("\n");
}

/** The `## Nola` section for AGENTS.md — also the paste snippet when skipped. */
export function agentsSection(s: SkillSource, version: string): string {
  return ["## Nola", "", stamp(version), "", s.body, "", LOCAL_REFERENCES, ""].join("\n");
}

function agentsMd(s: SkillSource, version: string): string {
  return `# AGENTS.md\n\n${agentsSection(s, version)}`;
}

/** Agents whose tooling is already present in the project. */
export function detectAgents(targetDir: string): AgentId[] {
  const root = resolve(targetDir);
  const found: AgentId[] = [];
  if (existsSync(join(root, ".claude")) || existsSync(join(root, "CLAUDE.md"))) found.push("claude");
  if (existsSync(join(root, ".cursor"))) found.push("cursor");
  if (existsSync(join(root, ".github"))) found.push("copilot");
  return found;
}

/** The interactive preselection: detected agents + the cross-agent baseline. */
export function defaultAgents(targetDir: string): AgentId[] {
  return [...detectAgents(targetDir), "agents-md"];
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
  // Legacy pointers are checked FIRST and independently of the stamp: the
  // 0.1.0–0.1.3 adapters predate stamping, so they carry none at all.
  const legacy = existing.includes(LEGACY_MARKER);
  if (!legacy) {
    if (!found) {
      return {
        write: false,
        note: `${path} already exists and was not generated by nola — left untouched`,
        stale: false,
      };
    }
    if (found[1] === version) return { write: false, note: `${path} is up to date (v${version})`, stale: false };
  }
  if (force) return { write: true };
  const what = legacy
    ? `${path} uses the superseded pointer form`
    : `${path} is stale (v${found?.[1]} → v${version})`;
  return { write: false, note: `${what} — re-run with --force to replace it`, stale: true };
}

/** Copy the canonical skill dir verbatim (stamp aside) into .claude/skills/nola/. */
async function writeClaudeSkill(root: string, s: SkillSource, version: string): Promise<string[]> {
  const dir = join(root, ".claude", "skills", "nola");
  await mkdir(join(dir, "references"), { recursive: true });
  const stamped = s.full.replace(/^(---\n[\s\S]*?\n---\n)/, `$1${stamp(version)}\n`);
  await writeFile(join(dir, "SKILL.md"), stamped);
  const wrote = [".claude/skills/nola/SKILL.md"];
  for (const name of (await readdir(join(SKILLS_DIR, "references"))).sort()) {
    await writeFile(join(dir, "references", name), await readFile(join(SKILLS_DIR, "references", name), "utf8"));
    wrote.push(`.claude/skills/nola/references/${name}`);
  }
  return wrote;
}

/**
 * Write the selected adapters as self-contained, version-stamped content.
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
  const skipped: string[] = [];
  let stale = false;

  const flat: Record<Exclude<AgentId, "claude">, { path: string; content: string }> = {
    cursor: { path: ".cursor/rules/nola.mdc", content: cursorRule(source, version) },
    copilot: { path: ".github/instructions/nola.instructions.md", content: copilotInstructions(source, version) },
    "agents-md": { path: "AGENTS.md", content: agentsMd(source, version) },
  };

  for (const id of AGENT_IDS) {
    if (!agents.includes(id)) continue;

    if (id === "claude") {
      const marker = join(root, ".claude", "skills", "nola", "SKILL.md");
      if (existsSync(marker)) {
        const d = disposition(".claude/skills/nola/SKILL.md", await readFile(marker, "utf8"), version, force);
        if (!d.write) {
          skipped.push(d.note);
          stale ||= d.stale;
          continue;
        }
      }
      wrote.push(...(await writeClaudeSkill(root, source, version)));
      continue;
    }

    const { path, content } = flat[id];
    const abs = join(root, ...path.split("/"));
    if (existsSync(abs)) {
      // AGENTS.md is a user file: never modified, --force included.
      if (id === "agents-md") {
        skipped.push(
          `AGENTS.md already exists — left untouched. Add this section manually:\n\n${agentsSection(source, version)}`,
        );
        continue;
      }
      const d = disposition(path, await readFile(abs, "utf8"), version, force);
      if (!d.write) {
        skipped.push(d.note);
        stale ||= d.stale;
        continue;
      }
    }
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
    wrote.push(path);
  }
  return { wrote, skipped, stale };
}
