import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export type AgentId = "claude" | "cursor" | "copilot" | "agents-md";

export const AGENT_IDS: readonly AgentId[] = ["claude", "cursor", "copilot", "agents-md"];

/** Shared option list for every "Set up coding agents?" multiselect. */
export const AGENT_OPTIONS: { value: AgentId; label: string; hint: string }[] = [
  { value: "agents-md", label: "AGENTS.md", hint: "cross-agent pointer file (Codex, Gemini CLI, …)" },
  { value: "claude", label: "Claude Code", hint: ".claude/skills/nola/SKILL.md" },
  { value: "cursor", label: "Cursor", hint: ".cursor/rules/nola.mdc" },
  { value: "copilot", label: "GitHub Copilot", hint: ".github/instructions/nola.instructions.md" },
];

/**
 * Adapters are POINTERS into the installed package, never copies — the
 * content an agent reads then always version-matches the installed compiler
 * (spec 2026-08-14-agent-skill-distribution-design.md §1).
 */
const POINTER_BODY = `Read \`node_modules/nola-lang/skills/nola/SKILL.md\` and the files under
\`node_modules/nola-lang/skills/nola/references/\` before writing or editing
\`.tsi\` files. If that path is missing, run \`npm install\` first.
`;

/**
 * Clause-free variant of POINTER_BODY: just the paths + the npm-install
 * fallback. For adapters whose own lead-in sentence already states the
 * "before writing or editing .tsi files" clause, so it isn't said twice.
 */
const POINTER_PATHS = `\`node_modules/nola-lang/skills/nola/SKILL.md\` and the files under
\`node_modules/nola-lang/skills/nola/references/\`. If that path is missing, run
\`npm install\` first.
`;

const CLAUDE_SKILL = `---
name: nola
description: Writing Nola .tsi files — a TypeScript superset with infer
  functions and ask extractors. Use when creating or editing .tsi files or
  nola.config.ts.
---

This project uses Nola. Before writing or editing \`.tsi\` files, read the
version-matched skill content installed with the language:
${POINTER_PATHS}`;

const AGENTS_SECTION = `## Nola

This project uses Nola (\`.tsi\` files — a TypeScript superset; not valid
TS). Before writing or editing \`.tsi\` files or \`nola.config.ts\`, read the
version-matched skill content installed with the language:

${POINTER_PATHS}`;

const AGENTS_MD = `# AGENTS.md

${AGENTS_SECTION}`;

const CURSOR_RULE = `---
description: Nola (.tsi) language rules
globs: ["**/*.tsi", "nola.config.ts"]
alwaysApply: false
---

${POINTER_BODY}`;

const COPILOT_INSTRUCTIONS = `---
applyTo: "**/*.tsi"
---

${POINTER_BODY}`;

const ADAPTERS: Record<AgentId, { path: string; content: string }> = {
  claude: { path: ".claude/skills/nola/SKILL.md", content: CLAUDE_SKILL },
  cursor: { path: ".cursor/rules/nola.mdc", content: CURSOR_RULE },
  copilot: { path: ".github/instructions/nola.instructions.md", content: COPILOT_INSTRUCTIONS },
  "agents-md": { path: "AGENTS.md", content: AGENTS_MD },
};

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
  const ids = value.split(",").map((s) => s.trim()).filter(Boolean);
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
}

/** Write the selected adapters; never rewrites an existing file. */
export async function writeAgentSkills(targetDir: string, agents: AgentId[]): Promise<AgentSetupResult> {
  const root = resolve(targetDir);
  const wrote: string[] = [];
  const skipped: string[] = [];
  for (const id of AGENT_IDS) {
    if (!agents.includes(id)) continue;
    const { path, content } = ADAPTERS[id];
    const abs = join(root, ...path.split("/"));
    if (existsSync(abs)) {
      // AGENTS.md commonly pre-exists; hand the section over for manual paste.
      skipped.push(
        id === "agents-md"
          ? `AGENTS.md already exists — left untouched. Add this section manually:\n\n${AGENTS_SECTION}`
          : `${path} already exists — left untouched`,
      );
      continue;
    }
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
    wrote.push(path);
  }
  return { wrote, skipped };
}
