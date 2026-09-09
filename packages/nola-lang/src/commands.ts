// The `nola` command table. Each entry declares its own flags (scoped per
// command — `nola login --out x` is a usage error) and the help is generated
// from it, so a new command is one entry here and nothing else.
import { ansi, type CliIo, type CommandSpec, defineCommand, FLOW_OPTIONS, type Palette } from "create-nola-lang";
import { cmdAccount } from "./account.js";
import { cmdBuild } from "./build.js";
import { cmdCheck } from "./check.js";
import { emitAdjacentDeclarations } from "./declarations.js";
import { cmdInit } from "./init.js";
import { cmdKey } from "./key.js";
import { cmdLogin, cmdLogout } from "./login.js";
import { cmdRun } from "./run.js";
import { cmdSkill } from "./skill.js";
import { styleDiagnostics } from "./style.js";

const consoleIo: CliIo = { log: (m) => console.log(m), error: (m) => console.error(m) };

/**
 * Print a command's diagnostics (styled, exit 1) or its one-line success
 * summary (exit 0): the file count when it writes, "no errors" otherwise.
 */
export function report(
  label: string,
  result: { written?: string[]; errors: string[] },
  separator: string,
  io: CliIo = consoleIo,
  p: Palette = ansi,
): number {
  if (result.errors.length > 0) {
    io.error(styleDiagnostics(result.errors.join(separator), p));
    return 1;
  }
  const outcome = result.written ? `${result.written.length} files written` : "no errors";
  io.log(`${p.ok(`nola ${label}:`)} ${outcome}`);
  return 0;
}

export const COMMANDS: readonly CommandSpec[] = [
  defineCommand({
    name: "init",
    summary: "scaffold a Nola project, or add Nola to an existing one (same flow as npm create nola-lang)",
    args: "[dir]",
    options: FLOW_OPTIONS,
    run: ({ positionals: [dir], values }) => cmdInit(dir, values),
  }),
  defineCommand({
    name: "key",
    summary: "get a Nola API key for this project (the machine's free trial, else your account) and offer it to .env",
    options: { print: { type: "boolean", description: "write only the key to stdout; sign-in instructions go to stderr" } },
    run: ({ values }) => cmdKey(values.print !== undefined ? { print: values.print } : {}),
  }),
  defineCommand({
    name: "login",
    summary: "sign in to Nola in the browser; links this project's trial key to your account",
    run: () => cmdLogin(),
  }),
  defineCommand({ name: "logout", summary: "sign out of Nola on this machine", run: () => cmdLogout() }),
  defineCommand({
    name: "account",
    summary: "show your Nola account and open it in the browser (signs you in first when needed)",
    run: () => cmdAccount(),
  }),
  defineCommand({
    name: "skill",
    summary: "write agent skill files (Claude Code, Cursor, Copilot, AGENTS.md) into the project",
    args: "install",
    options: {
      agents: { type: "string", description: "claude,cursor,copilot,agents-md | all | none" },
      force: { type: "boolean", description: "replace files stamped by another Nola version" },
    },
    run: ({ positionals: [sub], values }) => cmdSkill(sub, { agents: values.agents, force: values.force }),
  }),
  defineCommand({
    name: "build",
    summary: "compile all .tsi files (js + map + d.ts into --out)",
    args: "[dir]",
    options: { out: { type: "string", default: "dist", description: "output directory" } },
    run: async ({ positionals: [dir], values }) => report("build", await cmdBuild(dir ?? ".", values.out), "\n\n"),
  }),
  defineCommand({
    name: "run",
    summary: "run a .tsi/.js entry with the Nola loader + nola.config.ts",
    args: "<entry>",
    run: ({ positionals: [entry] }) => cmdRun(entry ?? ""),
  }),
  defineCommand({
    name: "console",
    summary: "start the local Nola Console (traces UI/API; loopback only)",
    options: { port: { type: "string", description: "listen port (default 4141)" } },
    run: async ({ values }) => {
      const port = values.port !== undefined ? Number(values.port) : undefined;
      if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
        console.error(`--port must be an integer in 0..65535 — got ${JSON.stringify(values.port)}.`);
        return 1;
      }
      const { cmdConsole } = await import("./console.js");
      return cmdConsole(port !== undefined ? { port } : {});
    },
  }),
  defineCommand({
    name: "check",
    summary: "type-check lowered .tsi files AND the project's .ts files, positions mapped back",
    args: "[dir]",
    run: async ({ positionals: [dir] }) => report("check", await cmdCheck(dir ?? "."), "\n"),
  }),
  defineCommand({
    name: "declarations",
    summary: "emit <name>.d.tsi.ts next to each .tsi so plain tsc resolves .tsi imports (allowArbitraryExtensions)",
    args: "[dir]",
    options: { watch: { type: "boolean", description: "re-emit whenever a .tsi changes (runs until Ctrl-C)" } },
    run: async ({ positionals: [dir = "."], values }) => {
      const once = async () => report("declarations", await emitAdjacentDeclarations(dir), "\n\n");
      const code = await once();
      if (!values.watch) return code;
      const { watch } = await import("node:fs");
      let timer: NodeJS.Timeout | undefined;
      watch(dir, { recursive: true }, (_event, name) => {
        if (name?.endsWith(".tsi")) {
          clearTimeout(timer);
          timer = setTimeout(once, 150);
        }
      });
      return new Promise<number>(() => {}); // watch runs until Ctrl-C
    },
  }),
];
