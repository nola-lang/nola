import { runSkillInstall } from "create-nola-lang";

const USAGE = "nola skill install [--agents claude,cursor,copilot,agents-md | all | none]";

/** `nola skill install` — write agent skill adapters into the current project. */
export async function cmdSkill(sub: string | undefined, opts: { agents?: string }): Promise<number> {
  if (sub !== "install") {
    console.log(USAGE);
    return sub ? 1 : 0;
  }
  return runSkillInstall({ agents: opts.agents });
}
