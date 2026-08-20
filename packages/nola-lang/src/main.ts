#!/usr/bin/env node
import { parseArgs } from "node:util";
import { cmdBuild } from "./build.js";
import { cmdCheck } from "./check.js";
import { emitAdjacentDeclarations } from "./declarations.js";
import { cmdInit } from "./init.js";
import { cmdRun } from "./run.js";
import { cmdSkill } from "./skill.js";

const HELP = `nola <command>

Commands:
  init [dir] [--template <t>|--add] [--ide vscode] [--agents <list>]  scaffold or retrofit a Nola project
  skill install [--agents <list>] [--force]  write agent skill files (Claude Code, Cursor, Copilot, AGENTS.md) into the project
  build [dir] [--out <dir>]   compile all .tsi files (js+map+d.ts to --out)
  run <entry>                 run a .tsi/.js entry with the Nola loader + nola.config.ts
  check [dir]                 type-check lowered .tsi files AND the project's .ts files, positions mapped back
  declarations [dir] [--watch]  emit <name>.d.tsi.ts next to each .tsi so plain tsc resolves .tsi imports (allowArbitraryExtensions)
`;

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string", default: "dist" },
      template: { type: "string" },
      add: { type: "boolean" },
      ide: { type: "string" },
      watch: { type: "boolean" },
      agents: { type: "string" },
      force: { type: "boolean" },
    },
  });
  const [command, arg] = positionals;
  switch (command) {
    case "build": {
      const { written, errors } = await cmdBuild(arg ?? ".", values.out);
      if (errors.length > 0) {
        console.error(errors.join("\n\n"));
        return 1;
      }
      console.log(`nola build: ${written.length} files written`);
      return 0;
    }
    case "check": {
      const { errors } = await cmdCheck(arg ?? ".");
      if (errors.length > 0) {
        console.error(errors.join("\n"));
        return 1;
      }
      console.log("nola check: no errors");
      return 0;
    }
    case "declarations": {
      const run = async (): Promise<number> => {
        const { written, errors } = await emitAdjacentDeclarations(arg ?? ".");
        if (errors.length > 0) {
          console.error(errors.join("\n\n"));
          return 1;
        }
        console.log(`nola declarations: ${written.length} files written`);
        return 0;
      };
      const code = await run();
      if (!values.watch) return code;
      const { watch } = await import("node:fs");
      let timer: NodeJS.Timeout | undefined;
      watch(arg ?? ".", { recursive: true }, (_event, name) => {
        if (name?.endsWith(".tsi")) {
          clearTimeout(timer);
          timer = setTimeout(run, 150);
        }
      });
      return await new Promise<number>(() => {}); // watch runs until Ctrl-C
    }
    case "run":
      return cmdRun(arg ?? "");
    case "init":
      return cmdInit(arg, { template: values.template, add: values.add, ide: values.ide, agents: values.agents });
    case "skill":
      return cmdSkill(arg, { agents: values.agents, force: values.force });
    default:
      console.log(HELP);
      return command ? 1 : 0;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
