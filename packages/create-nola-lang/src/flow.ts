import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { addNola } from "./add.js";
import { AGENT_OPTIONS, type AgentId, defaultAgents, parseAgentsFlag, writeAgentSkills } from "./agents.js";
import { ExampleFetchError } from "./github.js";
import { writeVscodeSetup } from "./ide.js";
import { detectPackageManager, type PackageManager, packageManagerCommands } from "./package-manager.js";
import { TEMPLATES, type TemplateDef, templateByName, templateNames } from "./registry.js";
import { ownVersion, scaffold } from "./scaffold.js";

export interface PrompterOption {
  value: string;
  label: string;
  hint?: string;
}

/** The seam between flow logic and the clack UI; tests inject a scripted one. */
export interface Prompter {
  /** null = cancelled */
  text(message: string, initialValue: string): Promise<string | null>;
  select(message: string, options: PrompterOption[]): Promise<string | null>;
  confirm(message: string, initialValue: boolean): Promise<boolean | null>;
  /** null = cancelled */
  multiselect(message: string, options: PrompterOption[], initialValues: string[]): Promise<string[] | null>;
  note(message: string): void;
  intro?(title: string): void;
  outro?(message: string): void;
}

export interface FlowInput {
  dir?: string;
  template?: string;
  add?: boolean;
  ide?: string;
  agents?: string;
  /** bare-run detection root; default "." — tests pass a tmp dir */
  cwd?: string;
  interactive: boolean;
}

export type FlowOutcome =
  | { kind: "scaffold"; dir: string; template: string; force: boolean; ide: "vscode" | "none"; agents: AgentId[] }
  | { kind: "add"; dir: string; ide: "vscode" | "none"; agents: AgentId[] }
  | { kind: "cancelled" };

const DEFAULT_DIR = "nola-app";
const DEFAULT_TEMPLATE = "starter";

function templateOption(t: TemplateDef): PrompterOption {
  return { value: t.name, label: t.source === "example" ? `example: ${t.name}` : t.name, hint: t.label };
}

/** The optional editor step; null = cancelled. Non-interactive default: none. */
async function resolveIde(input: FlowInput, prompter: Prompter): Promise<"vscode" | "none" | null> {
  if (input.ide === "vscode" || input.ide === "none") return input.ide;
  if (!input.interactive) return "none";
  const choice = await prompter.select("Set up your editor?", [
    { value: "vscode", label: "VS Code", hint: ".vscode/ with a debug launch config + extension recommendation" },
    { value: "none", label: "None" },
  ]);
  return choice === null ? null : (choice as "vscode" | "none");
}

/** The optional agents step; null = cancelled. Non-interactive default: none. */
async function resolveAgents(input: FlowInput, prompter: Prompter, dir: string): Promise<AgentId[] | null> {
  if (input.agents !== undefined) return parseAgentsFlag(input.agents);
  if (!input.interactive) return [];
  const choice = await prompter.multiselect("Set up coding agents?", AGENT_OPTIONS, defaultAgents(dir));
  return choice === null ? null : (choice as AgentId[]);
}

/** Editor + agents questions, shared by every outcome site; null = cancelled. */
async function resolveExtras(
  input: FlowInput,
  prompter: Prompter,
  dir: string,
): Promise<{ ide: "vscode" | "none"; agents: AgentId[] } | null> {
  const ide = await resolveIde(input, prompter);
  if (ide === null) return null;
  const agents = await resolveAgents(input, prompter, dir);
  return agents === null ? null : { ide, agents };
}

/** Args fill prompts; whatever is missing is asked (never asked non-interactively). */
export async function resolveScaffoldOptions(input: FlowInput, prompter: Prompter): Promise<FlowOutcome> {
  if (input.add && input.template) {
    throw new Error(
      "--add and --template are contradictory: --add retrofits an existing project, --template scaffolds a new one",
    );
  }
  if (input.ide !== undefined && input.ide !== "vscode" && input.ide !== "none") {
    throw new Error(`invalid --ide "${input.ide}" (valid: vscode, none)`);
  }
  if (input.agents !== undefined) parseAgentsFlag(input.agents); // throws on unknown ids
  if (input.add) {
    const dir = input.dir ?? input.cwd ?? ".";
    const extras = await resolveExtras(input, prompter, dir);
    if (extras === null) return { kind: "cancelled" };
    return { kind: "add", dir, ...extras };
  }

  let dir = input.dir;
  if (!dir) {
    if (input.interactive) {
      const cwd = input.cwd ?? ".";
      const cwdManifest = join(resolve(cwd), "package.json");
      if (existsSync(cwdManifest)) {
        let pkgName = "this project";
        try {
          const parsed = JSON.parse(await readFile(cwdManifest, "utf8")) as { name?: string };
          if (parsed.name) pkgName = `"${parsed.name}"`;
        } catch {
          // display-only — an unreadable manifest still gets the menu
        }
        const choice = await prompter.select(`Found package.json (${pkgName}). What do you want to do?`, [
          { value: "add", label: "Add Nola to this project", hint: `config + deps into the existing ${pkgName}` },
          { value: "new", label: "Create a new project", hint: "scaffold into a subdirectory" },
        ]);
        if (choice === null) return { kind: "cancelled" };
        if (choice === "add") {
          const extras = await resolveExtras(input, prompter, cwd);
          if (extras === null) return { kind: "cancelled" };
          return { kind: "add", dir: cwd, ...extras };
        }
      }
    }
    if (!input.interactive) {
      dir = DEFAULT_DIR;
    } else {
      const answer = await prompter.text("Project name:", DEFAULT_DIR);
      if (answer === null) return { kind: "cancelled" };
      dir = answer.trim() || DEFAULT_DIR;
    }
  }

  let force = false;
  const absRoot = resolve(dir);
  if (existsSync(absRoot) && (await readdir(absRoot)).length > 0) {
    if (!input.interactive) throw new Error(`target directory ${absRoot} is not empty`);
    if (existsSync(join(absRoot, "package.json"))) {
      const choice = await prompter.select(`Target directory "${dir}" is not empty and has a package.json.`, [
        { value: "add", label: "Add Nola to this existing project" },
        { value: "fresh", label: "Remove everything and scaffold fresh" },
        { value: "cancel", label: "Cancel" },
      ]);
      if (choice === null || choice === "cancel") return { kind: "cancelled" };
      if (choice === "add") {
        const extras = await resolveExtras(input, prompter, dir);
        if (extras === null) return { kind: "cancelled" };
        return { kind: "add", dir, ...extras };
      }
      force = true;
    } else {
      const ok = await prompter.confirm(
        `Target directory "${dir}" is not empty. Remove existing files and continue?`,
        false,
      );
      if (ok !== true) return { kind: "cancelled" };
      force = true;
    }
  }

  let template = input.template;
  if (template && !templateByName(template)) {
    if (!input.interactive) {
      throw new Error(`unknown template "${template}" (valid: ${templateNames().join(", ")})`);
    }
    prompter.note(`Unknown template "${template}" — pick one below.`);
    template = undefined;
  }
  if (!template) {
    if (!input.interactive) {
      template = DEFAULT_TEMPLATE;
    } else {
      const choice = await prompter.select("Select a template:", TEMPLATES.map(templateOption));
      if (choice === null) return { kind: "cancelled" };
      template = choice;
    }
  }

  const extras = await resolveExtras(input, prompter, dir);
  if (extras === null) return { kind: "cancelled" };
  return { kind: "scaffold", dir, template, force, ...extras };
}

/** Non-interactive prompter: output only; being asked anything is a bug. */
export function plainPrompter(): Prompter {
  const unavailable = async (): Promise<never> => {
    throw new Error("interactive prompt reached in non-interactive mode");
  };
  return {
    text: unavailable,
    select: unavailable,
    confirm: unavailable,
    multiselect: unavailable,
    note: (m) => console.log(m),
    outro: (m) => console.log(m),
  };
}

export interface RunFlowArgs {
  dir?: string;
  template?: string;
  add?: boolean;
  ide?: string;
  agents?: string;
}

export interface RunFlowOptions {
  intro?: string;
  prompter?: Prompter;
  interactive?: boolean;
  /** bare-run detection root; default "." — tests pass a tmp dir */
  cwd?: string;
  /** the manager that invoked us; default: detected from npm_config_user_agent */
  packageManager?: PackageManager;
}

function nextSteps(
  outcome: { dir: string; template: string },
  fileCount: number,
  name: string,
  pm: PackageManager,
): string {
  const cmd = packageManagerCommands(pm);
  const start = cmd.start.padEnd(16);
  const keyless =
    outcome.template === "empty" ? `${start} # set OPENAI_API_KEY first` : `${start} # runs offline — no API key needed`;
  const lines = outcome.dir === "." ? [cmd.install, keyless] : [`cd ${outcome.dir}`, cmd.install, keyless];
  return `Scaffolded ${name} (${fileCount} files).\n\nNext steps:\n  ${lines.join("\n  ")}`;
}

/** The shared entry for both `npm create nola-lang` and `nola init`. */
export async function runFlow(args: RunFlowArgs, opts: RunFlowOptions = {}): Promise<number> {
  const interactive = opts.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  let prompter = opts.prompter;
  if (!prompter) {
    if (interactive) {
      const { clackPrompter } = await import("./prompter.js");
      prompter = clackPrompter();
    } else {
      prompter = plainPrompter();
    }
  }
  if (interactive) prompter.intro?.(opts.intro ?? `create-nola-lang v${await ownVersion()}`);
  const pm = opts.packageManager ?? detectPackageManager();

  const input: FlowInput = {
    dir: args.dir,
    template: args.template,
    add: args.add,
    ide: args.ide,
    agents: args.agents,
    cwd: opts.cwd,
    interactive,
  };
  while (true) {
    const outcome = await resolveScaffoldOptions(input, prompter);
    if (outcome.kind === "cancelled") {
      prompter.note("Cancelled.");
      return 0;
    }
    if (outcome.kind === "add") {
      const result = await addNola(outcome.dir);
      // An explicit editor choice is honored even when Nola itself was already set up.
      const ide = outcome.ide === "vscode" ? await writeVscodeSetup(outcome.dir) : { wrote: [], skipped: [] };
      const ag =
        outcome.agents.length > 0 ? await writeAgentSkills(outcome.dir, outcome.agents) : { wrote: [], skipped: [] };
      for (const note of [...result.skipped, ...ide.skipped, ...ag.skipped]) prompter.note(note);
      const written = [...result.wrote, ...result.added, ...ide.wrote, ...ag.wrote];
      if (result.alreadySetUp && ide.wrote.length === 0 && ag.wrote.length === 0) {
        prompter.note("This project already has Nola.");
        return 0;
      }
      const lines = [
        packageManagerCommands(pm).install,
        'optional start script:  "start": "nola run src/main.ts"',
        'tsconfig tip: directory-style include (e.g. ["src"]) lets the editor see .tsi files',
      ];
      const message = `Added Nola: ${written.join(", ")}.\n\nNext steps:\n  ${lines.join("\n  ")}`;
      if (prompter.outro) prompter.outro(message);
      else console.log(message);
      return 0;
    }
    try {
      const { files } = await scaffold(outcome.dir, { template: outcome.template, force: outcome.force });
      let ideWrote: string[] = [];
      if (outcome.ide === "vscode") {
        const ide = await writeVscodeSetup(outcome.dir);
        ideWrote = ide.wrote;
        for (const note of ide.skipped) prompter.note(note);
      }
      let agWrote: string[] = [];
      if (outcome.agents.length > 0) {
        const ag = await writeAgentSkills(outcome.dir, outcome.agents);
        agWrote = ag.wrote;
        for (const note of ag.skipped) prompter.note(note);
      }
      const message = nextSteps(
        outcome,
        files.length + ideWrote.length + agWrote.length,
        basename(resolve(outcome.dir)),
        pm,
      );
      if (prompter.outro) prompter.outro(message);
      else console.log(message);
      return 0;
    } catch (err) {
      if (err instanceof ExampleFetchError && interactive) {
        prompter.note(`${err.message}\nThe "starter" and "empty" templates work offline.`);
        input.dir = outcome.dir; // keep the chosen dir, re-pick the template
        input.template = undefined;
        continue;
      }
      throw err;
    }
  }
}
