import { describe, expect, it } from "vitest";
import { type CliIo, type CommandSpec, defineCommand, dispatch, renderCommandHelp, renderHelp } from "../src/cli.js";
import { plain, tagPalette } from "../src/palette.js";

function fakeIo(): CliIo & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, log: (m) => out.push(m), error: (m) => err.push(m) };
}

const META = { name: "nola", version: "9.9.9", palette: plain };
const TAGGED = { ...META, palette: tagPalette };

function fixture() {
  const calls: Array<{ name: string; positionals: string[]; values: Record<string, unknown> }> = [];
  const build = defineCommand({
    name: "build",
    summary: "compile all .tsi files",
    args: "[dir]",
    options: {
      out: { type: "string", default: "dist", description: "output directory" },
      watch: { type: "boolean", description: "rebuild on change" },
    },
    run: async ({ positionals, values }) => {
      calls.push({ name: "build", positionals, values });
      return values.out === "fail" ? 7 : 0;
    },
  });
  const login = defineCommand({
    name: "login",
    summary: "sign in to Nola",
    run: async ({ positionals, values }) => {
      calls.push({ name: "login", positionals, values });
      return 0;
    },
  });
  const init = defineCommand({
    name: "init",
    summary: "scaffold a project",
    args: "[dir]",
    options: { trial: { type: "boolean", description: "request a trial key", negatable: true } },
    run: async ({ positionals, values }) => {
      calls.push({ name: "init", positionals, values });
      return 0;
    },
  });
  const commands: CommandSpec[] = [build, login, init];
  return { commands, calls };
}

describe("cli dispatch", () => {
  it("prints the generated help and exits 0 when no command is given", async () => {
    const { commands, calls } = fixture();
    const io = fakeIo();
    expect(await dispatch([], commands, META, io)).toBe(0);
    const text = io.out.join("\n");
    expect(text).toContain("nola <command>");
    expect(text).toContain("build [dir]");
    expect(text).toContain("compile all .tsi files");
    expect(text).toContain("login");
    expect(text).toContain("sign in to Nola");
    expect(calls).toHaveLength(0);
  });

  it("answers --help and -h at the top level", async () => {
    const { commands } = fixture();
    for (const flag of ["--help", "-h"]) {
      const io = fakeIo();
      expect(await dispatch([flag], commands, META, io)).toBe(0);
      expect(io.out.join("\n")).toContain("build [dir]");
    }
  });

  it("answers --version with the tool name and version", async () => {
    const { commands } = fixture();
    const io = fakeIo();
    expect(await dispatch(["--version"], commands, META, io)).toBe(0);
    expect(io.out).toEqual(["nola 9.9.9"]);
  });

  it("rejects an unknown command with the help on stderr and exit 1", async () => {
    const { commands, calls } = fixture();
    const io = fakeIo();
    expect(await dispatch(["frobnicate"], commands, META, io)).toBe(1);
    expect(io.err.join("\n")).toContain('unknown command "frobnicate"');
    expect(io.err.join("\n")).toContain("build [dir]");
    expect(calls).toHaveLength(0);
  });

  it("answers <command> --help with that command's usage and options", async () => {
    const { commands, calls } = fixture();
    const io = fakeIo();
    expect(await dispatch(["build", "--help"], commands, META, io)).toBe(0);
    const text = io.out.join("\n");
    expect(text).toContain("nola build [dir]");
    expect(text).toContain("--out <value>");
    expect(text).toContain("output directory");
    expect(text).toContain("--watch");
    expect(text).toContain("rebuild on change");
    expect(text).not.toContain("login");
    expect(calls).toHaveLength(0);
  });

  it("scopes options per command: a flag of another command is an error", async () => {
    const { commands, calls } = fixture();
    const io = fakeIo();
    expect(await dispatch(["login", "--out", "x"], commands, META, io)).toBe(1);
    const text = io.err.join("\n");
    expect(text).toContain("--out");
    expect(text).toContain("nola login");
    expect(calls).toHaveLength(0);
  });

  it("hands parsed positionals, values and defaults to the command", async () => {
    const { commands, calls } = fixture();
    expect(await dispatch(["build", "src", "--watch"], commands, META, fakeIo())).toBe(0);
    expect(calls).toEqual([{ name: "build", positionals: ["src"], values: { out: "dist", watch: true } }]);
  });

  it("propagates the command's exit code", async () => {
    const { commands } = fixture();
    expect(await dispatch(["build", "--out", "fail"], commands, META, fakeIo())).toBe(7);
  });

  it("accepts --no-<flag> for boolean options", async () => {
    const { commands, calls } = fixture();
    expect(await dispatch(["init", "app", "--no-trial"], commands, META, fakeIo())).toBe(0);
    expect(calls[0]?.values).toEqual({ trial: false });
  });

  it("lists commands in table order with aligned summaries", () => {
    const { commands } = fixture();
    const help = renderHelp(commands, "nola", plain);
    const lines = help.split("\n").filter((l) => l.startsWith("  "));
    expect(lines.map((l) => l.trim().split(/\s+/)[0])).toEqual(["build", "login", "init"]);
    const col = lines.map((l) => l.indexOf(l.trim().replace(/^\S+(\s\[dir\])?\s+/, "")));
    expect(new Set(col).size).toBe(1);
  });

  it("renders --no- spelling only for negatable options in command help", () => {
    const { commands } = fixture();
    const text = renderCommandHelp(commands[2] as CommandSpec, "nola", plain);
    expect(text).toContain("--trial");
    expect(text).toContain("--no-trial");
    const build = renderCommandHelp(commands[0] as CommandSpec, "nola", plain);
    expect(build).not.toContain("--no-out");
    expect(build).not.toContain("--no-watch");
  });
});

describe("cli colours", () => {
  it("colours the command list: heading, command names, dim args", () => {
    const { commands } = fixture();
    const help = renderHelp(commands, "nola", tagPalette);
    expect(help).toContain("<heading>nola <command></heading>");
    expect(help).toContain("<heading>Commands:</heading>");
    expect(help).toContain("<command>build</command> <dim>[dir]</dim>");
    expect(help).toContain("<command>login</command>");
    expect(help).toContain("Run `<command>nola <command> --help</command>`");
  });

  it("keeps the summary column aligned when the names are coloured", () => {
    const { commands } = fixture();
    const strip = (s: string) => s.replace(/<\/?\w+>/g, "");
    const lines = renderHelp(commands, "nola", tagPalette)
      .split("\n")
      .filter((l) => l.startsWith("  "))
      .map(strip);
    const col = lines.map((l) => l.indexOf(l.trim().replace(/^\S+(\s\[dir\])?\s+/, "")));
    expect(new Set(col).size).toBe(1);
  });

  it("colours a command's help: usage, flags, dim defaults", () => {
    const { commands } = fixture();
    const help = renderCommandHelp(commands[0] as CommandSpec, "nola", tagPalette);
    expect(help).toContain("<heading>nola</heading> <command>build</command> <dim>[dir]</dim>");
    expect(help).toContain("<heading>Options:</heading>");
    expect(help).toContain("<flag>--out</flag> <dim><value></dim>");
    expect(help).toContain("output directory <dim>(default dist)</dim>");
    expect(help).toContain("<flag>--watch</flag>");
  });

  it("paints usage errors and unknown commands in the error role", async () => {
    const { commands } = fixture();
    const io = fakeIo();
    await dispatch(["login", "--out", "x"], commands, TAGGED, io);
    expect(io.err[0]).toContain("<error>nola login: Unknown option '--out'</error>");
    const io2 = fakeIo();
    await dispatch(["frobnicate"], commands, TAGGED, io2);
    expect(io2.err[0]).toContain('<error>nola: unknown command "frobnicate"</error>');
  });

  it("dispatch defaults to the terminal palette when none is given", async () => {
    const { commands } = fixture();
    const io = fakeIo();
    expect(await dispatch(["--version"], commands, { name: "nola", version: "1" }, io)).toBe(0);
    expect(io.out).toEqual(["nola 1"]);
  });
});

describe("the create bin's command", () => {
  it("declares the flow flags once, with help, for both bins", async () => {
    const { CREATE_COMMAND, FLOW_OPTIONS } = await import("../src/flow.js");
    expect(Object.keys(FLOW_OPTIONS).sort()).toEqual(["add", "agents", "ide", "provider", "template", "trial"]);
    for (const opt of Object.values(FLOW_OPTIONS)) expect(opt.description).toBeTruthy();
    const help = renderCommandHelp(CREATE_COMMAND, "npm create", plain);
    expect(help).toContain("npm create nola-lang [dir]");
    expect(help).toContain("--template <value>");
    expect(help).toContain("--no-trial");
    expect(help).toContain("--provider <value>");
  });
});
