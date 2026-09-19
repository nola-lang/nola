import { runFlow } from "create-nola-lang";

export interface InitOptions {
  template?: string;
  add?: boolean;
  ide?: string;
  agents?: string;
  /** --provider nola|openai|anthropic|google|typesafe|none; undefined = ask interactively, none otherwise */
  provider?: string;
  /** --trial / --no-trial: shorthand for --provider nola / none */
  trial?: boolean;
}

/** `nola init [dir] [--template <name>|--add] [--ide vscode|none] [--agents <list>] [--provider <id>|--trial|--no-trial]` — the same flow `npm create nola-lang` runs. */
export async function cmdInit(dir: string | undefined, opts: InitOptions): Promise<number> {
  return runFlow({ dir, ...opts }, { intro: "nola init" });
}
