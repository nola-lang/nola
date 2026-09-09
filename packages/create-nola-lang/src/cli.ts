// The command table behind the `nola` bin: each command declares its own
// parseArgs option map, so flags are scoped per command, and the help text is
// generated from the table instead of being maintained by hand.
import { type ParseArgsOptionsConfig, parseArgs } from "node:util";
import { ansi, type Palette } from "./palette.js";

/** One option's declaration: the `node:util` descriptor plus a help line. */
export interface OptionSpec {
  type: "string" | "boolean";
  default?: string | boolean;
  /** shown in `<command> --help` */
  description?: string;
  /** boolean only: mention `--no-<name>` in the help (every boolean accepts it; say so where "off" is a meaningful answer) */
  negatable?: boolean;
}

type ParsedValues<O extends Record<string, OptionSpec>> = ReturnType<
  typeof parseArgs<{ options: O; allowPositionals: true; allowNegative: true }>
>["values"];

export interface CommandContext<O extends Record<string, OptionSpec>> {
  positionals: string[];
  values: ParsedValues<O>;
}

export interface CommandSpec<O extends Record<string, OptionSpec> = Record<string, OptionSpec>> {
  name: string;
  /** one line for the command list */
  summary: string;
  /** positional syntax for usage lines, e.g. "[dir]" or "<entry>" */
  args?: string;
  options?: O;
  run(ctx: CommandContext<O>): Promise<number>;
}

/** Identity with inference: keeps `values` typed from the option map. */
export function defineCommand<O extends Record<string, OptionSpec>>(spec: CommandSpec<O>): CommandSpec {
  return spec as unknown as CommandSpec;
}

export interface CliIo {
  log(message: string): void;
  error(message: string): void;
}

export interface CliMeta {
  name: string;
  version: string;
  /** colour roles for help and usage errors; default: the terminal palette */
  palette?: Palette;
}

const consoleIo: CliIo = { log: (m) => console.log(m), error: (m) => console.error(m) };

/** Plain usage text (for column widths) and its coloured twin. */
function usageOf(cmd: CommandSpec, p: Palette): { plain: string; styled: string } {
  const plain = cmd.args ? `${cmd.name} ${cmd.args}` : cmd.name;
  const styled = cmd.args ? `${p.command(cmd.name)} ${p.dim(cmd.args)}` : p.command(cmd.name);
  return { plain, styled };
}

function flagOf(name: string, opt: OptionSpec, p: Palette): { plain: string; styled: string } {
  if (opt.type === "boolean") return { plain: `--${name}`, styled: p.flag(`--${name}`) };
  return { plain: `--${name} <value>`, styled: `${p.flag(`--${name}`)} ${p.dim("<value>")}` };
}

/** Pad to `width` by the PLAIN length, so colour escapes never shift a column. */
function pad(text: { plain: string; styled: string }, width: number): string {
  return text.styled + " ".repeat(Math.max(0, width - text.plain.length));
}

function optionLines(cmd: CommandSpec, p: Palette): string[] {
  const options = cmd.options ?? {};
  const names = Object.keys(options);
  if (names.length === 0) return [];
  const flags = names.map((n) => flagOf(n, options[n] as OptionSpec, p));
  const width = Math.max(...flags.map((f) => f.plain.length));
  return names.map((n, i) => {
    const opt = options[n] as OptionSpec;
    let text = opt.description ?? "";
    if (opt.default !== undefined) text += `${text ? " " : ""}${p.dim(`(default ${String(opt.default)})`)}`;
    if (opt.negatable) text += `${text ? "; " : ""}${p.flag(`--no-${n}`)} to turn off`;
    return `  ${pad(flags[i] as { plain: string; styled: string }, width)}  ${text}`.trimEnd();
  });
}

/** The top-level help: `<name> <command>` plus one aligned line per command. */
export function renderHelp(commands: readonly CommandSpec[], name: string, p: Palette = ansi): string {
  const usages = commands.map((c) => usageOf(c, p));
  const width = Math.max(...usages.map((u) => u.plain.length));
  const lines = commands.map((c, i) => `  ${pad(usages[i] as { plain: string; styled: string }, width)}  ${c.summary}`);
  return [
    p.heading(`${name} <command>`),
    "",
    p.heading("Commands:"),
    ...lines,
    "",
    `Run \`${p.command(`${name} <command> --help`)}\` for a command's options.`,
  ].join("\n");
}

/** One command's help: usage line, summary, and its options. */
export function renderCommandHelp(cmd: CommandSpec, name: string, p: Palette = ansi): string {
  const lines = [`${p.heading(name)} ${usageOf(cmd, p).styled}`, "", cmd.summary];
  const opts = optionLines(cmd, p);
  if (opts.length > 0) lines.push("", p.heading("Options:"), ...opts);
  return lines.join("\n");
}

/**
 * Route `argv` (without the node/script prefix) to a command: the top-level
 * help/version flags, then the named command parsed with ITS options only.
 * Returns the process exit code; never throws for a usage error.
 */
export async function dispatch(
  argv: readonly string[],
  commands: readonly CommandSpec[],
  meta: CliMeta,
  io: CliIo = consoleIo,
): Promise<number> {
  const p = meta.palette ?? ansi;
  const [head, ...rest] = argv;
  if (head === undefined || head === "--help" || head === "-h") {
    io.log(renderHelp(commands, meta.name, p));
    return 0;
  }
  if (head === "--version" || head === "-v") {
    io.log(`${meta.name} ${meta.version}`);
    return 0;
  }
  const cmd = commands.find((c) => c.name === head);
  if (!cmd) {
    io.error(`${p.error(`${meta.name}: unknown command "${head}"`)}\n\n${renderHelp(commands, meta.name, p)}`);
    return 1;
  }
  if (rest.includes("--help") || rest.includes("-h")) {
    io.log(renderCommandHelp(cmd, meta.name, p));
    return 0;
  }
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: rest,
      options: (cmd.options ?? {}) as ParseArgsOptionsConfig,
      allowPositionals: true,
      allowNegative: true, // --no-<flag> → false (Node ≥ 22.4)
    });
  } catch (err) {
    const message = err instanceof Error ? err.message.split(". To specify")[0] : String(err);
    io.error(`${p.error(`${meta.name} ${cmd.name}: ${message}`)}\n\n${renderCommandHelp(cmd, meta.name, p)}`);
    return 1;
  }
  // OptionSpec has no `multiple`, so no value is ever an array; narrow the generic parseArgs result.
  return cmd.run({ positionals: parsed.positionals, values: parsed.values as CommandContext<Record<string, OptionSpec>>["values"] });
}
