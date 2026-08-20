import { AGENT_OPTIONS, type AgentId, defaultAgents, parseAgentsFlag, writeAgentSkills } from "./agents.js";
import { type Prompter, plainPrompter } from "./flow.js";

export interface SkillInstallArgs {
  /** target project dir; default "." */
  dir?: string;
  /** raw --agents flag value */
  agents?: string;
  /** replace files stamped by another version */
  force?: boolean;
}

export interface SkillInstallOptions {
  prompter?: Prompter;
  interactive?: boolean;
}

/** The `nola skill install` entry — same delegation shape as `nola init` → runFlow. */
export async function runSkillInstall(args: SkillInstallArgs, opts: SkillInstallOptions = {}): Promise<number> {
  const interactive = opts.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const dir = args.dir ?? ".";
  let prompter = opts.prompter;
  if (!prompter) {
    if (interactive) {
      const { clackPrompter } = await import("./prompter.js");
      prompter = clackPrompter();
    } else {
      prompter = plainPrompter();
    }
  }

  let agents: AgentId[];
  if (args.agents !== undefined) {
    agents = parseAgentsFlag(args.agents);
  } else if (!interactive) {
    prompter.note("non-interactive: pass --agents (claude, cursor, copilot, agents-md — or all, none)");
    return 1;
  } else {
    const choice = await prompter.multiselect("Set up coding agents?", AGENT_OPTIONS, defaultAgents(dir));
    if (choice === null) {
      prompter.note("Cancelled.");
      return 0;
    }
    agents = choice as AgentId[];
  }
  if (agents.length === 0) {
    prompter.note("Nothing selected — no files written.");
    return 0;
  }

  const result = await writeAgentSkills(dir, agents, { force: args.force });
  for (const note of result.skipped) prompter.note(note);
  let message = "Nothing new to write.";
  if (result.wrote.length > 0) message = `Installed agent skill files: ${result.wrote.join(", ")}`;
  else if (result.stale) message = "Nothing written — re-run with --force to replace outdated files.";
  if (prompter.outro) prompter.outro(message);
  else prompter.note(message);
  return 0;
}
