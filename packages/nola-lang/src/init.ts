import { runFlow } from "create-nola-lang";

export interface InitOptions {
  template?: string;
  add?: boolean;
  ide?: string;
  agents?: string;
}

/** `nola init [dir] [--template <name>|--add] [--ide vscode|none] [--agents <list>]` — the same flow `npm create nola-lang` runs. */
export async function cmdInit(dir: string | undefined, opts: InitOptions): Promise<number> {
  return runFlow({ dir, ...opts }, { intro: "nola init" });
}
