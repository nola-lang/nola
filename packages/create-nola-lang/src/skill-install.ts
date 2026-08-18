import { AGENT_OPTIONS, type AgentId, defaultAgents, parseAgentsFlag, writeAgentSkills } from "./agents.js";
import { type Prompter, plainPrompter } from "./flow.js";

export interface SkillInstallArgs {
  /** target project dir; default "." */
  dir?: string;
  /** raw --agents flag value */
  agents?: string;
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

  const result = await writeAgentSkills(dir, agents);
  for (const note of result.skipped) prompter.note(note);
  const message =
    result.wrote.length > 0 ? `Installed agent skill files: ${result.wrote.join(", ")}` : "Nothing new to write.";
  if (prompter.outro) prompter.outro(message);
  else prompter.note(message);
  return 0;
}
