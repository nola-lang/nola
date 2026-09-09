import { FLOW_OPTIONS, plain, renderHelp, tagPalette } from "create-nola-lang";
import { describe, expect, it } from "vitest";
import { COMMANDS, report } from "../src/commands.js";

describe("nola command table", () => {
  it("lists every command with a summary, in the documented order", () => {
    expect(COMMANDS.map((c) => c.name)).toEqual([
      "init",
      "key",
      "login",
      "logout",
      "account",
      "skill",
      "build",
      "run",
      "console",
      "check",
      "declarations",
    ]);
    for (const c of COMMANDS) expect(c.summary, c.name).toBeTruthy();
  });

  it("declares init's flags through the create bin's FLOW_OPTIONS", () => {
    const init = COMMANDS.find((c) => c.name === "init");
    expect(init?.options).toBe(FLOW_OPTIONS);
  });

  it("scopes each flag to the commands that read it", () => {
    const flags = Object.fromEntries(COMMANDS.map((c) => [c.name, Object.keys(c.options ?? {})]));
    expect(flags).toEqual({
      init: ["template", "add", "ide", "agents", "provider", "trial"],
      key: ["print"],
      login: [],
      logout: [],
      account: [],
      skill: ["agents", "force"],
      build: ["out"],
      run: [],
      console: ["port"],
      check: [],
      declarations: ["watch"],
    });
  });

  it("documents every option in the generated help", () => {
    for (const c of COMMANDS) {
      for (const [name, opt] of Object.entries(c.options ?? {})) expect(opt.description, `${c.name} --${name}`).toBeTruthy();
    }
    expect(renderHelp(COMMANDS, "nola", plain)).toContain("skill install");
  });
});

describe("report", () => {
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, log: (m: string) => out.push(m), error: (m: string) => err.push(m) };
  };

  it("prints a green label with the file count and exits 0", () => {
    const o = io();
    expect(report("build", { written: ["a", "b"], errors: [] }, "\n\n", o, tagPalette)).toBe(0);
    expect(o.out).toEqual(["<ok>nola build:</ok> 2 files written"]);
    expect(o.err).toEqual([]);
  });

  it("says 'no errors' for a command that writes nothing", () => {
    const o = io();
    expect(report("check", { errors: [] }, "\n", o, tagPalette)).toBe(0);
    expect(o.out).toEqual(["<ok>nola check:</ok> no errors"]);
  });

  it("styles the diagnostics on stderr and exits 1", () => {
    const o = io();
    const errors = ["a.tsi:1:1 NOLA2008: one", "b.tsi:2:2 TS2322: two"];
    expect(report("check", { errors }, "\n", o, tagPalette)).toBe(1);
    expect(o.err).toEqual([
      "<path>a.tsi</path><dim>:1:1</dim> <error>NOLA2008</error>: one\n<path>b.tsi</path><dim>:2:2</dim> <error>TS2322</error>: two",
    ]);
    expect(o.out).toEqual([]);
  });
});
