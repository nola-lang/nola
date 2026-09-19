import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { addNola } from "./add.js";
import { AGENT_IDS, AGENT_OPTIONS, type AgentId, defaultAgents, parseAgentsFlag, writeAgentSkills } from "./agents.js";
import { type KeyGrant, NolaApiError, nolaApiUrl } from "./api.js";
import { signIn } from "./auth.js";
import {
  CHECKOUT_DIST_SKIP_GLOB,
  LINK_CHECKOUT_ENV,
  linkCheckoutFromEnv,
  linkCheckoutPackages,
  skipCheckoutDistInLaunch,
} from "./checkout.js";
import { type CommandSpec, defineCommand, type OptionSpec } from "./cli.js";
import { readSession } from "./credentials.js";
import { ExampleFetchError } from "./github.js";
import { readHomeConfig } from "./home-config.js";
import { writeVscodeSetup } from "./ide.js";
import { acquireKey, SignInRequiredError } from "./key.js";
import { type Launcher, realLauncher } from "./launch.js";
import { nodeVersionWarning } from "./node-version.js";
import { openBrowser } from "./open-url.js";
import { detectPackageManager, type PackageManager, packageManagerCommands } from "./package-manager.js";
import { isProviderId, PROVIDERS, type ProviderId, providerById, providerIds } from "./providers.js";
import { entryFile, exampleNames, featuredNames, TEMPLATES, type TemplateDef, templateByName, templateNames } from "./registry.js";
import { ownVersion, scaffold, vendorEnvVar } from "./scaffold.js";
import { applyTrial } from "./trial.js";

export interface PrompterOption {
  value: string;
  label: string;
  hint?: string;
}

/** One labelled section of a grouped multiselect; values must be unique across the groups. */
export interface PrompterGroup {
  label: string;
  options: PrompterOption[];
}

/** A long-running step shown as a spinner: `update` swaps the line under the title, `done` / `fail` end it. */
export interface ProgressHandle {
  update(message: string): void;
  done(message: string): void;
  fail(message: string): void;
}

/** The seam between flow logic and the clack UI; tests inject a scripted one. */
export interface Prompter {
  /** null = cancelled */
  text(message: string, initialValue: string): Promise<string | null>;
  select(message: string, options: PrompterOption[]): Promise<string | null>;
  confirm(message: string, initialValue: boolean): Promise<boolean | null>;
  /** null = cancelled */
  multiselect(message: string, options: PrompterOption[], initialValues: string[]): Promise<string[] | null>;
  /** one checkbox list split into labelled groups, all interactive at once; null = cancelled */
  groupMultiselect(message: string, groups: PrompterGroup[], initialValues: string[]): Promise<string[] | null>;
  /** starts a spinner titled `title`; the handle ends it */
  progress(title: string): ProgressHandle;
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
  /** --provider <id>; undefined = ask (interactive) or "none" (non-interactive) */
  provider?: string;
  /** --trial / --no-trial: shorthand for --provider nola / --provider none */
  trial?: boolean;
  /** how the nola row is worded, decided by runFlow from ~/.nola (spec 2026-09-04-cli-sign-in-design.md §5); default trial */
  keyPath?: KeyPath;
  /**
   * Runs the browser sign-in when the Nola row is chosen on a `sign-in`
   * machine — at the select, before any later question. Resolves true once a
   * session is stored; false means it already noted why (the menu is asked
   * again). Absent = the choice stands and the key step signs in later.
   */
  signIn?: () => Promise<boolean>;
  /** bare-run detection root; default "." — tests pass a tmp dir */
  cwd?: string;
  interactive: boolean;
}

/** Signed in → a key on the account; the machine's trial already used → sign in first; a fresh machine → the trial. */
export type KeyPath = { kind: "trial" } | { kind: "sign-in" } | { kind: "account"; email: string | null };

export type FlowOutcome =
  | {
    kind: "scaffold";
    dir: string;
    template: string;
    force: boolean;
    provider: ProviderId;
    ide: "vscode" | "none";
    agents: AgentId[];
  }
  | { kind: "add"; dir: string; provider: ProviderId; ide: "vscode" | "none"; agents: AgentId[] }
  | { kind: "cancelled" };

const DEFAULT_DIR = "nola-app";
const DEFAULT_TEMPLATE = "feature-extraction";

/*
 * The wizard, in order (spec 2026-08-12-interactive-init-design.md, reordered
 * 2026-09-03, provider select 2026-09-08): name → template → "Select an
 * inference provider" (Nola first — the free runs, or a key on the account —
 * then the vendors, then skip) → then — once the files are on disk —
 * "Install dependencies and open VS Code?". The editor setup and the agent
 * skill are written WITHOUT a question (2026-09-18; `--ide none` /
 * `--agents …` override): the "Set up your Editor and Coding Agents?" gate
 * and its grouped list are kept behind `SETUP_STEP_ASKED` should the step
 * come back. Every question is answered before anything is written; the
 * nola key request runs after the last question.
 */
export const NAME_QUESTION = `Project name (press Enter to keep "${DEFAULT_DIR}"):`;
/**
 * The retired setup step (2026-09-18). false = the editor setup and the agent
 * skill are defaults (`DEFAULT_IDE`, `defaultAgents`) and nothing is asked;
 * flip to true to bring the gate + grouped list back exactly as they were.
 */
const SETUP_STEP_ASKED: boolean = false;
/** The editor the scaffold sets up unless `--ide none` says otherwise. */
const DEFAULT_IDE = "vscode";
/** The yes/no gate in front of the setup list; narrowed when a flag already answered one half. */
export const SETUP_QUESTION = "Set up your Editor and Coding Agents?";
export const EDITOR_QUESTION = "Set up your Editor?";
export const AGENTS_QUESTION = "Set up Coding Agents?";
/** The grouped list a yes opens. */
export const SETUP_LIST_QUESTION = "What to set up? (Space toggles, Enter confirms)";
/** The editor half of the setup list. VS Code is a checkbox — unticked means none — which is honest only while it is the sole editor. */
const EDITOR_OPTIONS: PrompterOption[] = [
  { value: "vscode", label: "VS Code", hint: ".vscode/ with a debug launch config + extension recommendation" },
];

function templateOption(t: TemplateDef): PrompterOption {
  // a pinned template names its vendor in the row itself: `triage-ticket (typesafe.ai)`
  const vendor = t.provider ? ` (${t.provider.label})` : "";
  return { value: t.name, label: `${t.name}${vendor}`, hint: t.label };
}

/*
 * The template step is TWO menus (clack's select has no sections): the first
 * lists the first-menu templates — feature-extraction, function-calling,
 * typescript-interop, triage-ticket (the featured example), empty — and one
 * "More examples…" row; that row opens the remaining curated examples, with a
 * Back row to return. `--template <name>` answers either level directly.
 */
export const TEMPLATE_QUESTION = "Select a template:";
export const EXAMPLE_QUESTION = "Select an example:";
/** the first menu's last row — opens the examples menu */
export const MORE_EXAMPLES = "more-examples";
/** the examples menu's last row — back to the first menu */
export const BACK = "back";

/** `"feature-extraction", "function-calling", …` — for the fetch-failure note. */
const builtinNames = () =>
  TEMPLATES.filter((t) => t.source === "builtin")
    .map((t) => `"${t.name}"`)
    .join(", ");

/** The first menu: the builtin templates and the featured example in registry order, then the examples row. */
export function templateMenu(): PrompterOption[] {
  const featured = featuredNames().map((name) => templateOption(templateByName(name) as TemplateDef));
  return [...featured, { value: MORE_EXAMPLES, label: "More examples…", hint: exampleNames().join(", ") }];
}

/** The second menu: the curated examples the first menu does not carry, in registry order, then Back. */
export function exampleMenu(): PrompterOption[] {
  const examples = exampleNames().map((name) => templateOption(templateByName(name) as TemplateDef));
  return [...examples, { value: BACK, label: "← Back", hint: "the builtin templates" }];
}

/** Ask the two-level template menu until a template is chosen; null = cancelled. */
async function selectTemplate(prompter: Prompter): Promise<string | null> {
  for (;;) {
    const choice = await prompter.select(TEMPLATE_QUESTION, templateMenu());
    if (choice === null) return null;
    if (choice !== MORE_EXAMPLES) return choice;
    const example = await prompter.select(EXAMPLE_QUESTION, exampleMenu());
    if (example === null) return null;
    if (example !== BACK) return example;
  }
}

/**
 * The editor + agents answer. Today (the step is retired): the flags, else the
 * defaults — VS Code and both skill targets — interactive or not, so a scaffold
 * carries `.vscode/` and the skill unless `--ide none` / `--agents none` opt
 * out. With `SETUP_STEP_ASKED`: a yes/no gate (default yes), then editor +
 * coding agents in one grouped checkbox list with the same defaults
 * preselected; `--ide` / `--agents` each fill their half — a group a flag
 * already answered is not shown and the gate narrows to the half that
 * remains; a no leaves the asked halves at none. null = cancelled.
 */
async function resolveSetup(
  input: FlowInput,
  prompter: Prompter,
  dir: string,
): Promise<{ ide: "vscode" | "none"; agents: AgentId[] } | null> {
  const ide = input.ide === "vscode" || input.ide === "none" ? input.ide : undefined;
  const agents = input.agents !== undefined ? parseAgentsFlag(input.agents) : undefined;
  if (ide !== undefined && agents !== undefined) return { ide, agents };
  if (!input.interactive || !SETUP_STEP_ASKED) return { ide: ide ?? DEFAULT_IDE, agents: agents ?? defaultAgents(dir) };
  const groups: PrompterGroup[] = [];
  const initial: string[] = [];
  if (ide === undefined) {
    groups.push({ label: "Editor", options: EDITOR_OPTIONS });
    initial.push("vscode");
  }
  if (agents === undefined) {
    groups.push({ label: "Coding agents", options: AGENT_OPTIONS });
    initial.push(...defaultAgents(dir));
  }
  const gate = groups.length === 2 ? SETUP_QUESTION : ide === undefined ? EDITOR_QUESTION : AGENTS_QUESTION;
  const wanted = await prompter.confirm(gate, true);
  if (wanted === null) return null;
  if (!wanted) return { ide: ide ?? "none", agents: agents ?? [] };
  const choice = await prompter.groupMultiselect(SETUP_LIST_QUESTION, groups, initial);
  if (choice === null) return null;
  return {
    ide: ide ?? (choice.includes("vscode") ? "vscode" : "none"),
    agents: agents ?? choice.filter((v): v is AgentId => (AGENT_IDS as readonly string[]).includes(v)),
  };
}

export const PROVIDER_QUESTION = "Select an inference provider:";
/** `nola key`'s confirmation before the browser opens (the scaffold's consent is the provider select itself). */
export const SIGN_IN_QUESTION = "This machine already used its 25 free Nola runs. Sign in to get an API key for this project?";

/**
 * The nola row's hint follows the machine (spec 2026-09-04-cli-sign-in-design.md
 * §5): the free runs on a fresh machine, the browser sign-in once this
 * machine used them, a key on the account when already signed in.
 */
export function nolaHint(path: KeyPath): string {
  switch (path.kind) {
    case "account":
      return `a key on your Nola account (signed in${path.email ? ` as ${path.email}` : ""})`;
    case "sign-in":
      return "Trial key already issued. Get another? Enter to sign in.";
    default:
      return providerById("nola")?.hint ?? "";
  }
}

/**
 * The typesafe row's bracket: the vendor serves literal unions and booleans
 * only, so for a template whose asks go further the hint says so by name
 * (the template was chosen one question earlier); no template (add mode)
 * gets the generic form; a template whose own config already names
 * typesafe.ai needs no warning.
 */
function typesafeHint(base: string, template: string | undefined): string {
  if (template === undefined) return `${base} (literal unions and booleans only)`;
  if (templateByName(template)?.provider?.label === "typesafe.ai") return base;
  return `${base} (does not support every construct in ${template}: literal unions and booleans only)`;
}

/** The provider menu with the nola row worded for this machine and the typesafe row for this template. */
export function providerOptions(path: KeyPath, template?: string): PrompterOption[] {
  return PROVIDERS.map((p) => ({
    value: p.id,
    label: p.label,
    hint: p.id === "nola" ? nolaHint(path) : p.id === "typesafe" ? typesafeHint(p.hint, template) : p.hint,
  }));
}

/** The provider a flag already chose: `--provider`, else the `--trial` / `--no-trial` shorthands; throws when they disagree. */
function flaggedProvider(input: FlowInput): ProviderId | undefined {
  const fromTrial = input.trial === undefined ? undefined : input.trial ? "nola" : "none";
  if (input.provider === undefined) return fromTrial;
  if (!isProviderId(input.provider)) {
    throw new Error(`invalid --provider "${input.provider}" (valid: ${providerIds().join(", ")})`);
  }
  if (fromTrial !== undefined && fromTrial !== input.provider) {
    throw new Error(`--${input.trial ? "trial" : "no-trial"} contradicts --provider ${input.provider}`);
  }
  return input.provider;
}

/**
 * The provider step — right after the template; null = cancelled. Asked only
 * interactively (Nola highlighted); non-interactive default: none, so a
 * scripted run never touches the network unless a flag asks for it. On a
 * machine whose trial is used, Enter on the Nola row runs the browser
 * sign-in RIGHT HERE (`input.signIn`) — the row's hint announced it — so the
 * browser never opens after later questions; a failed sign-in was noted by
 * the callback and the menu is shown again (skip or another provider are
 * one Enter away, Ctrl+C cancels). The key itself is minted later, on the
 * stored session, after every question — nothing is consumed by a cancel.
 */
async function resolveProvider(input: FlowInput, prompter: Prompter, template?: string): Promise<ProviderId | null> {
  const flagged = flaggedProvider(input);
  if (flagged !== undefined) return flagged;
  // A template whose own config names its vendor (triage-ticket → typesafe())
  // is not asked: "none" keeps that config, and the outro names its env var.
  const pinned = template !== undefined && templateByName(template)?.provider !== undefined;
  if (pinned || !input.interactive) return "none";
  const path = input.keyPath ?? { kind: "trial" };
  while (true) {
    const choice = await prompter.select(PROVIDER_QUESTION, providerOptions(path, template));
    if (choice === null) return null;
    if (!isProviderId(choice)) throw new Error(`unexpected provider choice "${choice}"`);
    if (choice === "nola" && path.kind === "sign-in" && input.signIn && !(await input.signIn())) continue;
    return choice;
  }
}

/** The provider and setup (editor + agents) questions, in that order, shared by every outcome site; null = cancelled. */
async function resolveExtras(
  input: FlowInput,
  prompter: Prompter,
  dir: string,
  template?: string,
): Promise<{ provider: ProviderId; ide: "vscode" | "none"; agents: AgentId[] } | null> {
  const provider = await resolveProvider(input, prompter, template);
  if (provider === null) return null;
  const setup = await resolveSetup(input, prompter, dir);
  return setup === null ? null : { provider, ...setup };
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
  flaggedProvider(input); // throws on an unknown id or a contradiction
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
      const answer = await prompter.text(NAME_QUESTION, DEFAULT_DIR);
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
      const choice = await selectTemplate(prompter);
      if (choice === null) return { kind: "cancelled" };
      template = choice;
    }
  }

  const extras = await resolveExtras(input, prompter, dir, template);
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
    groupMultiselect: unavailable,
    progress: (title) => {
      console.log(title);
      return { update: () => { }, done: (m) => console.log(m), fail: (m) => console.log(m) };
    },
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
  provider?: string;
  trial?: boolean;
}

/**
 * The flow's flags, declared ONCE for both bins (`npm create nola-lang` and
 * `nola init`): parseArgs descriptors plus the help line each shows.
 */
export const FLOW_OPTIONS = {
  template: {
    type: "string",
    description: "template to scaffold (feature-extraction, function-calling, typescript-interop, empty, or a curated example)",
  },
  add: { type: "boolean", description: "add Nola to the existing project in [dir] instead of scaffolding" },
  ide: { type: "string", description: "editor setup: vscode (the default) | none" },
  agents: {
    type: "string",
    description: `agent skill files: ${AGENT_IDS.join(",")} | all | none (default: claude,universal)`,
  },
  provider: {
    type: "string",
    description: `inference provider: ${providerIds().join(" | ")} (nola = 25 free runs; non-interactive default: none)`,
  },
  trial: { type: "boolean", description: "shorthand for --provider nola (--no-trial: --provider none)", negatable: true },
} as const satisfies Record<string, OptionSpec>;

/** The `npm create nola-lang [dir]` bin as a command (tool "npm create", command "nola-lang"): one positional, the flow flags. */
export const CREATE_COMMAND: CommandSpec = defineCommand({
  name: "nola-lang",
  summary: "scaffold a new Nola project, or add Nola to an existing one",
  args: "[dir]",
  options: FLOW_OPTIONS,
  run: ({ positionals, values }) => runFlow({ dir: positionals[0], ...values }),
});

export interface RunFlowOptions {
  intro?: string;
  prompter?: Prompter;
  interactive?: boolean;
  /** bare-run detection root; default "." — tests pass a tmp dir */
  cwd?: string;
  /** the manager that invoked us; default: detected from npm_config_user_agent */
  packageManager?: PackageManager;
  /** runs the optional "install + open VS Code" step; tests inject a recorder */
  launcher?: Launcher;
  /** the trial request's fetch; tests inject a fake */
  fetch?: typeof globalThis.fetch;
  /** the directory holding .nola/config.json; default os.homedir() */
  home?: string;
  /** API base URL; default NOLA_API_URL env, else https://api.nola.sh */
  apiUrl?: string;
  /** browser opener for the sign-in step; default openBrowser */
  open?: (url: string) => boolean;
  /** checkout root to relink a scaffold to after install; default NOLA_LINK_CHECKOUT env (null = off) */
  linkCheckout?: string | null;
  /** the Node version to judge for the old-Node warning; default process.versions.node — tests inject one */
  nodeVersion?: string;
}

/** The tracing suggestion every outro ends with; `npx nola-lang` works under every package manager (the docs' form). */
const CONSOLE_COMMAND = "npx nola-lang console";
const CONSOLE_NOTE = "trace every ask in your browser (it prints the config line to add)";
/** Commands with a trailing comment share one column, sized by the longest of them (the console command). */
const COMMENT_COLUMN = CONSOLE_COMMAND.length + 1;

function commented(command: string, note: string): string {
  return `${command.padEnd(COMMENT_COLUMN)} # ${note}`;
}

function nextSteps(
  outcome: { dir: string; template: string; provider: ProviderId },
  fileCount: number,
  name: string,
  pm: PackageManager,
  installed = false,
  grant: KeyGrant | null = null,
): string {
  const cmd = packageManagerCommands(pm);
  // a chosen vendor's env var, else the one the template's own config reads (a pinned template under "none")
  const vendorEnv = vendorEnvVar(outcome.template, outcome.provider);
  const startNote = grant
    ? grant.source === "trial"
      ? "25 free Nola runs — key in .env"
      : "key in .env (run `npx nola-lang account` to check the balance)"
    : vendorEnv
      ? `set ${vendorEnv} in .env first`
      : outcome.template === "empty"
        ? "set OPENAI_API_KEY first"
        : "runs offline — no API key needed";

  const lines = [
    ...(outcome.dir === "." ? [] : [`cd ${outcome.dir}`]),
    ...(installed ? [] : [cmd.install]),
    commented(cmd.start, startNote),
    commented(CONSOLE_COMMAND, CONSOLE_NOTE),
  ];

  return `Scaffolded ${name} (${fileCount} files).\n\nNext steps:\n  ${lines.join("\n  ")}`;
}

/** How many trailing lines of a failed install's output the note shows. */
const INSTALL_LOG_TAIL = 20;

/** The last non-empty output line, colour codes stripped, trimmed to one spinner line. */
export function lastOutputLine(output: string): string | undefined {
  const lines = stripVTControlCharacters(output).split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (line) return line.length > 80 ? `${line.slice(0, 79)}…` : line;
  }
  return undefined;
}

/** The last question when VS Code's `code` command is on PATH… */
export const INSTALL_OPEN_QUESTION = "Install dependencies and open VS Code?";
/** …and when it is not (2026-09-18): the editor is neither promised nor opened. */
export const INSTALL_QUESTION = "Install dependencies?";

/**
 * The optional last step: "Install dependencies and open VS Code?" — or just
 * "Install dependencies?" on a machine without VS Code's `code` command,
 * which then opens nothing. Offered only when the scaffold is interactive AND
 * an editor was chosen — the editor step is what makes opening it meaningful.
 * A yes runs the package manager's install under a spinner (its output is
 * captured, the latest line shown beneath the title, the tail printed only on
 * failure) and then opens the project in VS Code; Ctrl+C here is a plain no
 * (the project is already on disk). Returns whether the install succeeded so
 * the outro can drop that line.
 */
async function offerInstallAndOpen(
  dir: string,
  entryPath: string,
  pm: PackageManager,
  prompter: Prompter,
  launcher: Launcher,
  linkCheckout: string | null,
): Promise<{ installed: boolean }> {
  const vscode = launcher.hasVscode();
  const yes = await prompter.confirm(vscode ? INSTALL_OPEN_QUESTION : INSTALL_QUESTION, true);
  if (!yes) return { installed: false };
  const cmd = packageManagerCommands(pm);
  const task = prompter.progress(`Installing dependencies (${cmd.install})`);
  let output = "";
  const exit = await launcher.install(pm, dir, (chunk) => {
    output += chunk;
    const line = lastOutputLine(output);
    if (line) task.update(line);
  });
  const installed = exit === 0;
  if (installed) {
    task.done(`Installed dependencies (${cmd.install})`);
    // Dev mode: the scaffold pins the published version range (what users
    // get), so the install just fetched the last npm release. With
    // NOLA_LINK_CHECKOUT naming a nola-monorepo checkout, point the scaffold
    // at that workspace build instead.
    if (linkCheckout !== null) {
      const linked = await linkCheckoutPackages(dir, linkCheckout);
      // The linked runtime now lives outside node_modules, so the launch
      // config must blackbox it too or F10 over the first ask runs to the end.
      const skipped = await skipCheckoutDistInLaunch(dir);
      prompter.note(
        `${LINK_CHECKOUT_ENV}: linked ${linked.join(", ")} to ${join(linkCheckout, "packages")} — ` +
        `a later ${cmd.install} restores the registry copies.` +
        (skipped ? `\nAdded "${CHECKOUT_DIST_SKIP_GLOB}" to skipFiles in .vscode/launch.json so stepping stays in your code.` : ""),
      );
    }
  } else {
    task.fail(`${cmd.install} failed (exit code ${exit})`);
    const tail = stripVTControlCharacters(output).trim().split(/\r?\n/).slice(-INSTALL_LOG_TAIL).join("\n");
    prompter.note(`${tail ? `${tail}\n` : ""}Run ${cmd.install} yourself once the cause is fixed.`);
  }
  if (!vscode) return { installed };
  // Land on the entry file, not an empty window: it opens with the next
  // steps (F5, breakpoints, the extension) as its first lines.
  const entry = existsSync(join(dir, entryPath)) ? entryPath : undefined;
  const opened = await launcher.openVscode(dir, entry);
  if (opened === "not-found") {
    // `code` was on PATH a moment ago and is gone now — rare, but say so.
    prompter.note(
      "VS Code's `code` command is not on PATH, so the folder was not opened. " +
      "In VS Code run \"Shell Command: Install 'code' command in PATH\" (macOS) or re-run the installer with \"Add to PATH\" (Windows), then open the folder from VS Code.",
    );
  }
  return { installed };
}

/**
 * A Retry-After wait in words. The per-address daily limit answers with the
 * seconds left in the day ("49832 s" — nobody reads that as fourteen hours),
 * so anything beyond two minutes is rounded up to whole minutes or hours.
 */
export function formatWait(ms: number): string {
  const secs = Math.ceil(ms / 1000);
  if (secs < 120) return `${secs} s`;
  const [n, unit] = secs < 3600 ? [Math.ceil(secs / 60), "minute"] : [Math.ceil(secs / 3600), "hour"];
  return `about ${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** Why the trial could not be provisioned, and how to retry — the scaffold itself is unaffected. */
function trialFailureNote(err: unknown): string {
  let reason = err instanceof Error ? err.message : String(err);
  if (err instanceof NolaApiError && err.status === 429) {
    const wait = err.retryAfterMs !== undefined && err.retryAfterMs > 0 ? ` — try again in ${formatWait(err.retryAfterMs)}` : "";
    reason = `too many trials from this network${wait} (${err.message})`;
  }
  return `Could not get a Nola API key: ${reason}\nThe project uses its default provider instead. Retry later with \`npx nola-lang key\`, then set \`model: "nola"\` in nola.config.ts.`;
}

/**
 * `acquireKey` for the scaffold: a failure is a note, never an exit code (the
 * project still scaffolds, plain). A sign-in, when the path needs one, runs
 * here — after every question, before any file is written.
 */
async function obtainTrial(prompter: Prompter, opts: RunFlowOptions, interactive: boolean): Promise<KeyGrant | null> {
  try {
    return await acquireKey({
      ...(opts.home !== undefined ? { home: opts.home } : {}),
      ...(opts.apiUrl !== undefined ? { apiUrl: opts.apiUrl } : {}),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      interactive,
      note: (message) => prompter.note(message),
      open: opts.open ?? openBrowser,
    });
  } catch (err) {
    prompter.note(err instanceof SignInRequiredError ? err.message : trialFailureNote(err));
    return null;
  }
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
  if (interactive) prompter.intro?.(opts.intro ?? `nola v${await ownVersion()}`);
  // Before anything else: an old Node (native .ts loading still behind a flag)
  // gets the advice here, where it names the fix, not from `npm start`'s bare error.
  const nodeWarning = nodeVersionWarning(opts.nodeVersion);
  if (nodeWarning) prompter.note(nodeWarning);
  const pm = opts.packageManager ?? detectPackageManager();

  // Which key question to ask (spec 2026-09-04-cli-sign-in-design.md §5): signed in → account key; trial used here → sign in; else → trial.
  const apiUrl = (opts.apiUrl ?? nolaApiUrl()).replace(/\/$/, "");
  const session = await readSession(opts.home, apiUrl);
  const keyPath: KeyPath = session
    ? { kind: "account", email: session.email }
    : (await readHomeConfig(opts.home))?.accounts[apiUrl]
      ? { kind: "sign-in" }
      : { kind: "trial" };

  // Enter on the Nola row of a used machine: the browser sign-in runs at the select (the key is minted later, on the session).
  const signInNow = async (): Promise<boolean> => {
    try {
      await signIn({
        ...(opts.home !== undefined ? { home: opts.home } : {}),
        apiUrl,
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
        note: (message) => prompter.note(message),
        open: opts.open ?? openBrowser,
      });
      return true;
    } catch (err) {
      prompter.note(`Could not sign in to Nola: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  };

  const input: FlowInput = {
    dir: args.dir,
    template: args.template,
    add: args.add,
    ide: args.ide,
    agents: args.agents,
    provider: args.provider,
    trial: args.trial,
    keyPath,
    signIn: signInNow,
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
      const grant = outcome.provider === "nola" ? await obtainTrial(prompter, opts, interactive) : null;
      const result = await addNola(outcome.dir, { provider: outcome.provider });
      const trial = grant
        ? await applyTrial(outcome.dir, { apiKey: grant.apiKey, hasConfig: !result.wrote.includes("nola.config.ts") })
        : { wrote: [], skipped: [] };
      // An explicit editor choice is honored even when Nola itself was already set up.
      const ide = outcome.ide === "vscode" ? await writeVscodeSetup(outcome.dir) : { wrote: [], skipped: [] };
      const ag =
        outcome.agents.length > 0
          ? await writeAgentSkills(outcome.dir, outcome.agents)
          : { wrote: [], removed: [], skipped: [] };
      for (const note of [...result.skipped, ...trial.skipped, ...ide.skipped, ...ag.skipped]) prompter.note(note);
      // applyTrial re-writes the config addNola just wrote — list it once.
      const trialWrote = trial.wrote.filter((f) => !result.wrote.includes(f));
      const written = [...result.wrote, ...result.added, ...trialWrote, ...ide.wrote, ...ag.wrote];
      if (result.alreadySetUp && trialWrote.length === 0 && ide.wrote.length === 0 && ag.wrote.length === 0) {
        prompter.note("This project already has Nola.");
        return 0;
      }
      const lines = [
        packageManagerCommands(pm).install,
        'optional start script:  "start": "nola run src/main.ts"',
        'tsconfig tip: directory-style include (e.g. ["src"]) lets the editor see .tsi files',
        commented(CONSOLE_COMMAND, CONSOLE_NOTE),
      ];
      const message = `Added Nola: ${written.join(", ")}.\n\nNext steps:\n  ${lines.join("\n  ")}`;
      if (prompter.outro) prompter.outro(message);
      else console.log(message);
      return 0;
    }
    try {
      const grant = outcome.provider === "nola" ? await obtainTrial(prompter, opts, interactive) : null;
      // A nola choice without a key (declined sign-in, API failure) scaffolds the plain template — the note above says why.
      const provider: ProviderId = outcome.provider === "nola" ? (grant ? "nola" : "none") : outcome.provider;
      const { files } = await scaffold(outcome.dir, { template: outcome.template, force: outcome.force, provider, ide: outcome.ide });
      let trialWrote: string[] = [];
      if (grant) {
        const trial = await applyTrial(outcome.dir, { apiKey: grant.apiKey, hasConfig: false });
        trialWrote = trial.wrote.filter((f) => !files.includes(f));
        for (const note of trial.skipped) prompter.note(note);
      }
      let ideWrote: string[] = [];
      if (outcome.ide === "vscode") {
        const ide = await writeVscodeSetup(outcome.dir, entryFile(outcome.template));
        ideWrote = ide.wrote;
        for (const note of ide.skipped) prompter.note(note);
      }
      let agWrote: string[] = [];
      if (outcome.agents.length > 0) {
        const ag = await writeAgentSkills(outcome.dir, outcome.agents);
        agWrote = ag.wrote;
        for (const note of ag.skipped) prompter.note(note);
      }
      const launch =
        interactive && outcome.ide !== "none"
          ? await offerInstallAndOpen(outcome.dir, entryFile(outcome.template), pm, prompter, opts.launcher ?? realLauncher, opts.linkCheckout ?? linkCheckoutFromEnv())
          : { installed: false };
      const message = nextSteps(
        { ...outcome, provider },
        files.length + trialWrote.length + ideWrote.length + agWrote.length,
        basename(resolve(outcome.dir)),
        pm,
        launch.installed,
        grant,
      );
      if (prompter.outro) prompter.outro(message);
      else console.log(message);
      return 0;
    } catch (err) {
      if (err instanceof ExampleFetchError && interactive) {
        prompter.note(`${err.message}\nThe builtin templates (${builtinNames()}) work offline.`);
        input.dir = outcome.dir; // keep the chosen dir, re-pick the template
        input.template = undefined;
        continue;
      }
      throw err;
    }
  }
}
