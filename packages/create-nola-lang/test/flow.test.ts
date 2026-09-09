import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkoutRoot } from "../src/checkout.js";
import { CREDENTIALS_FILE } from "../src/credentials.js";
import {
  AGENTS_QUESTION,
  EDITOR_QUESTION,
  lastOutputLine,
  NAME_QUESTION,
  nolaHint,
  PROVIDER_QUESTION,
  type Prompter,
  type PrompterOption,
  resolveScaffoldOptions,
  runFlow,
  SETUP_LIST_QUESTION,
  SETUP_QUESTION,
} from "../src/flow.js";
import { HOME_CONFIG_FILE } from "../src/home-config.js";

const tmp = () => mkdtemp(join(tmpdir(), "nola-flow-"));

/** Scripted prompter: consumes queued answers; records notes. */
function scripted(script: {
  text?: (string | null)[];
  select?: (string | null)[];
  confirm?: (boolean | null)[];
  multiselect?: (string[] | null)[];
  groupMultiselect?: (string[] | null)[];
}): Prompter & { notes: string[] } {
  const text = [...(script.text ?? [])];
  const select = [...(script.select ?? [])];
  const confirm = [...(script.confirm ?? [])];
  const multiselect = [...(script.multiselect ?? [])];
  const groupMultiselect = [...(script.groupMultiselect ?? [])];
  const notes: string[] = [];
  return {
    notes,
    text: async () => (text.length > 0 ? (text.shift() as string | null) : null),
    select: async () => (select.length > 0 ? (select.shift() as string | null) : null),
    confirm: async () => (confirm.length > 0 ? (confirm.shift() as boolean | null) : null),
    multiselect: async () => (multiselect.length > 0 ? (multiselect.shift() as string[] | null) : null),
    groupMultiselect: async () => (groupMultiselect.length > 0 ? (groupMultiselect.shift() as string[] | null) : null),
    progress: (title) => {
      notes.push(`progress: ${title}`);
      return {
        update: (m) => {
          notes.push(`progress update: ${m}`);
        },
        done: (m) => {
          notes.push(`progress done: ${m}`);
        },
        fail: (m) => {
          notes.push(`progress fail: ${m}`);
        },
      };
    },
    intro: (m) => {
      notes.push(m);
    },
    note: (m) => {
      notes.push(m);
    },
    outro: (m) => {
      notes.push(m);
    },
  };
}

describe("resolveScaffoldOptions", () => {
  it("prompts name then template when nothing is given", async () => {
    const p = scripted({ text: ["my-proj"], select: ["empty"], groupMultiselect: [[]] , confirm: [true] });
    const out = await resolveScaffoldOptions({ interactive: true, provider: "none", cwd: await tmp() }, p);
    expect(out).toEqual({
      kind: "scaffold",
      dir: "my-proj",
      template: "empty",
      force: false,
      provider: "none",
      ide: "none",
      agents: [],
    });
  });

  it("skips the name prompt when dir is given, the template prompt when --template is given", async () => {
    const p = scripted({ groupMultiselect: [[]] , confirm: [true] });
    const out = await resolveScaffoldOptions({ dir: "given-dir", template: "starter", interactive: true, provider: "none" }, p);
    expect(out).toEqual({
      kind: "scaffold",
      dir: "given-dir",
      template: "starter",
      force: false,
      provider: "none",
      ide: "none",
      agents: [],
    });
  });

  it("applies defaults non-interactively", async () => {
    const out = await resolveScaffoldOptions({ interactive: false }, scripted({}));
    expect(out).toEqual({
      kind: "scaffold",
      dir: "nola-app",
      template: "starter",
      force: false,
      provider: "none",
      ide: "none",
      agents: [],
    });
  });

  it("empty name answer falls back to the default", async () => {
    const p = scripted({ text: ["   "], select: ["starter"], groupMultiselect: [[]] , confirm: [true] });
    const out = await resolveScaffoldOptions({ interactive: true, provider: "none", cwd: await tmp() }, p);
    expect(out).toMatchObject({ kind: "scaffold", dir: "nola-app" });
  });

  it("cancelling the name prompt cancels the flow", async () => {
    const out = await resolveScaffoldOptions({ interactive: true, provider: "none", cwd: await tmp() }, scripted({ text: [null] }));
    expect(out).toEqual({ kind: "cancelled" });
  });

  it("rejects an unknown --template non-interactively, listing valid names", async () => {
    await expect(resolveScaffoldOptions({ dir: "d", template: "nope", interactive: false }, scripted({}))).rejects.toThrow(
      /unknown template "nope".*starter/,
    );
  });

  it("falls back to the menu on an unknown --template interactively", async () => {
    const p = scripted({ select: ["classify-message"], groupMultiselect: [[]] , confirm: [true] });
    const out = await resolveScaffoldOptions({ dir: "d", template: "nope", interactive: true, provider: "none" }, p);
    expect(out).toMatchObject({ kind: "scaffold", template: "classify-message" });
    expect(p.notes.join("\n")).toContain('Unknown template "nope"');
  });

  it("non-empty target: declining the remove-confirm cancels", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "keep.txt"), "x");
    const out = await resolveScaffoldOptions({ dir, template: "starter", interactive: true, provider: "none" }, scripted({ confirm: [false] }));
    expect(out).toEqual({ kind: "cancelled" });
  });

  it("non-empty target: confirming sets force", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "old.txt"), "x");
    const out = await resolveScaffoldOptions(
      { dir, template: "starter", interactive: true, provider: "none" },
      scripted({ confirm: [true, true], groupMultiselect: [[]] }),
    );
    expect(out).toMatchObject({ kind: "scaffold", dir, force: true });
  });

  it("non-empty target errors non-interactively (today's behavior)", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "keep.txt"), "x");
    await expect(resolveScaffoldOptions({ dir, interactive: false }, scripted({}))).rejects.toThrow(/not empty/);
  });
});

describe("runFlow", () => {
  it("scaffolds non-interactively with an explicit dir and template", async () => {
    const dir = join(await tmp(), "app");
    const code = await runFlow({ dir, template: "empty" }, { interactive: false, prompter: scripted({}) });
    expect(code).toBe(0);
    expect(existsSync(join(dir, "nola.config.ts"))).toBe(true);
  });

  it("drives the full interactive path through the scripted prompter (example from the dev checkout)", async () => {
    const dir = join(await tmp(), "resume-app");
    const p = scripted({ select: ["extract-resume"], groupMultiselect: [[]] , confirm: [true] });
    const code = await runFlow({ dir, provider: "none" }, { interactive: true, prompter: p });
    expect(code).toBe(0);
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(pkg.name).toBe("resume-app");
  });

  it("opens the interactive flow with the short `nola v<version>` banner", async () => {
    const p = scripted({ text: [null] });
    await runFlow({ provider: "none" }, { interactive: true, prompter: p, cwd: await tmp() });
    const version = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;
    expect(p.notes[0]).toBe(`nola v${version}`);
  });

  it("returns 0 and writes nothing when cancelled", async () => {
    const dir = join(await tmp(), "never");
    const code = await runFlow({ provider: "none" }, { interactive: true, prompter: scripted({ text: [null] }), cwd: await tmp() });
    expect(code).toBe(0);
    expect(existsSync(dir)).toBe(false);
  });
});

describe("resolveScaffoldOptions — add mode", () => {
  it("--add resolves straight to the add outcome (default dir '.')", async () => {
    const out = await resolveScaffoldOptions({ add: true, interactive: false }, scripted({}));
    expect(out).toEqual({ kind: "add", dir: ".", provider: "none", ide: "none", agents: [] });
  });

  it("--add keeps an explicit dir", async () => {
    const out = await resolveScaffoldOptions(
      { add: true, dir: "proj", interactive: true, provider: "none" },
      scripted({ groupMultiselect: [[]] , confirm: [true] }),
    );
    expect(out).toEqual({ kind: "add", dir: "proj", provider: "none", ide: "none", agents: [] });
  });

  it("--add with --template is contradictory", async () => {
    await expect(
      resolveScaffoldOptions({ add: true, template: "starter", interactive: false }, scripted({})),
    ).rejects.toThrow(/--add and --template/);
  });

  it("bare interactive run detects the cwd package.json and offers add", async () => {
    const cwd = await tmp();
    await writeFile(join(cwd, "package.json"), '{"name":"my-api"}');
    const p = scripted({ select: ["add"], groupMultiselect: [[]] , confirm: [true] });
    const out = await resolveScaffoldOptions({ interactive: true, provider: "none", cwd }, p);
    expect(out).toEqual({ kind: "add", dir: cwd, provider: "none", ide: "none", agents: [] });
  });

  it("detection: choosing new project continues into the normal flow", async () => {
    const cwd = await tmp();
    await writeFile(join(cwd, "package.json"), '{"name":"my-api"}');
    const p = scripted({ select: ["new", "empty"], text: ["fresh-app"], groupMultiselect: [[]] , confirm: [true] });
    const out = await resolveScaffoldOptions({ interactive: true, provider: "none", cwd }, p);
    expect(out).toEqual({
      kind: "scaffold",
      dir: "fresh-app",
      template: "empty",
      force: false,
      provider: "none",
      ide: "none",
      agents: [],
    });
  });

  it("a dir argument bypasses detection", async () => {
    const cwd = await tmp();
    await writeFile(join(cwd, "package.json"), '{"name":"my-api"}');
    const p = scripted({ select: ["starter"], groupMultiselect: [[]] , confirm: [true] });
    const out = await resolveScaffoldOptions({ dir: "sub", interactive: true, provider: "none", cwd }, p);
    expect(out).toMatchObject({ kind: "scaffold", dir: "sub", template: "starter" });
  });

  it("non-interactive bare run never detects (stays deterministic)", async () => {
    const cwd = await tmp();
    await writeFile(join(cwd, "package.json"), '{"name":"my-api"}');
    const out = await resolveScaffoldOptions({ interactive: false, cwd }, scripted({}));
    expect(out).toEqual({
      kind: "scaffold",
      dir: "nola-app",
      template: "starter",
      force: false,
      provider: "none",
      ide: "none",
      agents: [],
    });
  });

  it("non-empty target WITH package.json offers add", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "package.json"), '{"name":"existing"}');
    const p = scripted({ select: ["add"], groupMultiselect: [[]] , confirm: [true] });
    const out = await resolveScaffoldOptions({ dir, template: "starter", interactive: true, provider: "none" }, p);
    expect(out).toEqual({ kind: "add", dir, provider: "none", ide: "none", agents: [] });
  });

  it("non-empty target WITH package.json can still scaffold fresh", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "package.json"), '{"name":"existing"}');
    const p = scripted({ select: ["fresh"], groupMultiselect: [[]] , confirm: [true] });
    const out = await resolveScaffoldOptions({ dir, template: "starter", interactive: true, provider: "none" }, p);
    expect(out).toEqual({ kind: "scaffold", dir, template: "starter", force: true, provider: "none", ide: "none", agents: [] });
  });

  it("non-empty target WITHOUT package.json keeps the remove-confirm", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "keep.txt"), "x");
    const p = scripted({ confirm: [true, true], groupMultiselect: [[]] });
    const out = await resolveScaffoldOptions({ dir, template: "starter", interactive: true, provider: "none" }, p);
    expect(out).toEqual({ kind: "scaffold", dir, template: "starter", force: true, provider: "none", ide: "none", agents: [] });
  });
});

describe("resolveScaffoldOptions — editor step", () => {
  it("choosing VS Code carries ide through the scaffold outcome", async () => {
    const p = scripted({ select: ["starter"], groupMultiselect: [["vscode"]] , confirm: [true] });
    const out = await resolveScaffoldOptions({ dir: "d", interactive: true, provider: "none" }, p);
    expect(out).toEqual({
      kind: "scaffold",
      dir: "d",
      template: "starter",
      force: false,
      provider: "none",
      ide: "vscode",
      agents: [],
    });
  });

  it("the add path asks the setup question too", async () => {
    const cwd = await tmp();
    await writeFile(join(cwd, "package.json"), '{"name":"my-api"}');
    const p = scripted({ select: ["add"], groupMultiselect: [["vscode"]] , confirm: [true] });
    const out = await resolveScaffoldOptions({ interactive: true, provider: "none", cwd }, p);
    expect(out).toEqual({ kind: "add", dir: cwd, provider: "none", ide: "vscode", agents: [] });
  });

  it("--ide vscode drops the editor group; only the agents half is asked", async () => {
    const p = scripted({ select: ["starter"], groupMultiselect: [[]] , confirm: [true] });
    const asked: string[] = [];
    const inner = p.groupMultiselect;
    p.groupMultiselect = (m, groups, initial) => {
      asked.push(`${m}|${groups.map((g) => g.label).join("+")}|${initial.join(",")}`);
      return inner(m, groups, initial);
    };
    const confirm = p.confirm;
    p.confirm = (m, i) => {
      asked.push(`${m}|${i}`);
      return confirm(m, i);
    };
    const out = await resolveScaffoldOptions({ dir: "d", ide: "vscode", interactive: true, provider: "none" }, p);
    expect(out).toEqual({
      kind: "scaffold",
      dir: "d",
      template: "starter",
      force: false,
      provider: "none",
      ide: "vscode",
      agents: [],
    });
    expect(asked).toEqual([`${AGENTS_QUESTION}|true`, `${SETUP_LIST_QUESTION}|Coding agents|claude`]);
  });

  it("--ide none answers the editor half; the agents half is still asked", async () => {
    const out = await resolveScaffoldOptions(
      { dir: "d", template: "starter", ide: "none", interactive: true, provider: "none" },
      scripted({ groupMultiselect: [[]] , confirm: [true] }),
    );
    expect(out).toEqual({ kind: "scaffold", dir: "d", template: "starter", force: false, provider: "none", ide: "none", agents: [] });
  });

  it("rejects an invalid --ide listing valid values", async () => {
    await expect(
      resolveScaffoldOptions({ dir: "d", ide: "emacs", interactive: false }, scripted({})),
    ).rejects.toThrow(/invalid --ide "emacs".*vscode.*none/);
  });

  it("cancelling the setup gate cancels the flow", async () => {
    const p = scripted({ select: ["starter"] }); // the gate's confirm consumes past the queue -> null
    const out = await resolveScaffoldOptions({ dir: "d", interactive: true, provider: "none" }, p);
    expect(out).toEqual({ kind: "cancelled" });
  });
});

describe("runFlow — editor step", () => {
  it("writes .vscode when the scaffold outcome carries ide: vscode", async () => {
    const dir = join(await tmp(), "app");
    const code = await runFlow({ dir, template: "empty", ide: "vscode" }, { interactive: false, prompter: scripted({}) });
    expect(code).toBe(0);
    expect(existsSync(join(dir, ".vscode", "launch.json"))).toBe(true);
    expect(existsSync(join(dir, ".vscode", "extensions.json"))).toBe(true);
  });

  it("writes .vscode on add mode and reports existing files as skipped", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "package.json"), '{"name":"existing-api"}\n');
    await mkdir(join(dir, ".vscode"), { recursive: true });
    await writeFile(join(dir, ".vscode", "launch.json"), "// mine\n");
    const p = scripted({});
    const code = await runFlow({ dir, add: true, ide: "vscode" }, { interactive: false, prompter: p });
    expect(code).toBe(0);
    expect(await readFile(join(dir, ".vscode", "launch.json"), "utf8")).toBe("// mine\n");
    expect(existsSync(join(dir, ".vscode", "extensions.json"))).toBe(true);
    expect(p.notes.join("\n")).toContain(".vscode/launch.json already exists");
  });

  it("non-interactive without --ide writes no .vscode (unchanged default)", async () => {
    const dir = join(await tmp(), "app");
    await runFlow({ dir, template: "empty" }, { interactive: false, prompter: scripted({}) });
    expect(existsSync(join(dir, ".vscode"))).toBe(false);
  });
});

describe("runFlow — install + open VS Code step", () => {
  /** Records what the flow would have executed instead of spawning anything. */
  function recordingLauncher(opts: { installExit?: number; code?: "opened" | "not-found"; output?: string[] } = {}) {
    const calls: string[] = [];
    return {
      calls,
      launcher: {
        install: async (pm: string, dir: string, onOutput: (chunk: string) => void) => {
          calls.push(`install:${pm}:${basename(dir)}`);
          for (const chunk of opts.output ?? ["\nadded 12 packages in 3s\n"]) onOutput(chunk);
          return opts.installExit ?? 0;
        },
        openVscode: async (dir: string) => {
          calls.push(`code:${basename(dir)}`);
          return opts.code ?? ("opened" as const);
        },
      },
    };
  }

  it("asks after the scaffold when VS Code was chosen; yes installs then opens, in the project dir", async () => {
    const dir = join(await tmp(), "app");
    const p = scripted({ select: ["empty"], groupMultiselect: [["vscode"]], confirm: [true, true] });
    const { calls, launcher } = recordingLauncher();
    const code = await runFlow({ dir, provider: "none" }, { interactive: true, prompter: p, launcher, packageManager: "pnpm" });
    expect(code).toBe(0);
    expect(calls).toEqual(["install:pnpm:app", "code:app"]);
    // the install runs under a spinner: title, the latest output line, then the success line
    expect(p.notes).toContain("progress: Installing dependencies (pnpm install)");
    expect(p.notes).toContain("progress update: added 12 packages in 3s");
    expect(p.notes).toContain("progress done: Installed dependencies (pnpm install)");
    // the outro no longer tells the user to install
    const outro = p.notes.at(-1) ?? "";
    expect(outro).toContain("Next steps");
    expect(outro).not.toContain("pnpm install");
    expect(outro).toContain("pnpm start");
  });

  it("with NOLA_LINK_CHECKOUT set, a successful install is relinked to that checkout's packages and the outro says so", async () => {
    const dir = join(await tmp(), "app");
    const p = scripted({ select: ["empty"], groupMultiselect: [["vscode"]], confirm: [true, true] });
    const { launcher } = recordingLauncher();
    const workspace = (await checkoutRoot()) as string;
    const code = await runFlow({ dir, provider: "none" }, { interactive: true, prompter: p, launcher, linkCheckout: workspace });
    expect(code).toBe(0);
    expect(await realpath(join(dir, "node_modules", "nola-lang"))).toBe(await realpath(join(workspace, "packages", "nola-lang")));
    expect(await realpath(join(dir, "node_modules", "@nola-lang", "runtime"))).toBe(
      await realpath(join(workspace, "packages", "runtime")),
    );
    const notes = p.notes.join("\n");
    expect(notes).toContain("NOLA_LINK_CHECKOUT: linked @nola-lang/runtime, @nola-lang/providers, nola-lang");
    expect(notes).toContain("npm install");
  });

  it("the env variable is read when the option is absent", async () => {
    const dir = join(await tmp(), "app");
    const p = scripted({ select: ["empty"], groupMultiselect: [["vscode"]], confirm: [true, true] });
    const { launcher } = recordingLauncher();
    const workspace = (await checkoutRoot()) as string;
    const prev = process.env.NOLA_LINK_CHECKOUT;
    process.env.NOLA_LINK_CHECKOUT = workspace;
    try {
      await runFlow({ dir, provider: "none" }, { interactive: true, prompter: p, launcher });
    } finally {
      if (prev === undefined) delete process.env.NOLA_LINK_CHECKOUT;
      else process.env.NOLA_LINK_CHECKOUT = prev;
    }
    expect(await realpath(join(dir, "node_modules", "nola-lang"))).toBe(await realpath(join(workspace, "packages", "nola-lang")));
  });

  it("without NOLA_LINK_CHECKOUT nothing is linked, even inside the checkout", async () => {
    const dir = join(await tmp(), "app");
    const p = scripted({ select: ["empty"], groupMultiselect: [["vscode"]], confirm: [true, true] });
    const { launcher } = recordingLauncher();
    await runFlow({ dir, provider: "none" }, { interactive: true, prompter: p, launcher, linkCheckout: null });
    expect(existsSync(join(dir, "node_modules", "nola-lang"))).toBe(false);
    expect(p.notes.join("\n")).not.toContain("NOLA_LINK_CHECKOUT");
  });

  it("no leaves everything to the user (nothing runs, install stays in Next steps)", async () => {
    const dir = join(await tmp(), "app");
    const p = scripted({ select: ["empty"], groupMultiselect: [["vscode"]], confirm: [true, false] });
    const { calls, launcher } = recordingLauncher();
    await runFlow({ dir, provider: "none" }, { interactive: true, prompter: p, launcher });
    expect(calls).toEqual([]);
    expect(p.notes.at(-1)).toContain("npm install");
  });

  it("Ctrl+C at that prompt is a no, not a flow cancel — the project is already written", async () => {
    const dir = join(await tmp(), "app");
    const p = scripted({ select: ["empty"], groupMultiselect: [["vscode"]], confirm: [true, null] });
    const { calls, launcher } = recordingLauncher();
    const code = await runFlow({ dir, provider: "none" }, { interactive: true, prompter: p, launcher });
    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(existsSync(join(dir, "nola.config.ts"))).toBe(true);
    expect(p.notes.join("\n")).not.toContain("Cancelled");
  });

  it("is never asked when the editor choice is None", async () => {
    const dir = join(await tmp(), "app");
    // no confirm answers queued: being asked would throw through the scripted prompter
    const p = scripted({ select: ["empty"], groupMultiselect: [[]] , confirm: [true] });
    const { calls, launcher } = recordingLauncher();
    await runFlow({ dir, provider: "none" }, { interactive: true, prompter: p, launcher });
    expect(calls).toEqual([]);
  });

  it("is never asked non-interactively, even with --ide vscode", async () => {
    const dir = join(await tmp(), "app");
    const { calls, launcher } = recordingLauncher();
    await runFlow({ dir, template: "empty", ide: "vscode" }, { interactive: false, prompter: scripted({}), launcher });
    expect(calls).toEqual([]);
  });

  it("is never asked on the add path", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "package.json"), '{"name":"existing-api"}\n');
    const p = scripted({ groupMultiselect: [["vscode"]] , confirm: [true] });
    const { calls, launcher } = recordingLauncher();
    await runFlow({ dir, add: true, provider: "none" }, { interactive: true, prompter: p, launcher });
    expect(calls).toEqual([]);
  });

  it("a failing install is reported with the output tail, and VS Code still opens", async () => {
    const dir = join(await tmp(), "app");
    const p = scripted({ select: ["empty"], groupMultiselect: [["vscode"]], confirm: [true, true] });
    const { calls, launcher } = recordingLauncher({
      installExit: 1,
      output: ["npm ERR! code E404\n", "npm ERR! 404 Not Found - GET https://registry.npmjs.org/nope\n"],
    });
    await runFlow({ dir, provider: "none" }, { interactive: true, prompter: p, launcher });
    expect(calls).toEqual(["install:npm:app", "code:app"]);
    const notes = p.notes.join("\n");
    expect(p.notes).toContain("progress fail: npm install failed (exit code 1)");
    expect(notes).toContain("npm ERR! code E404\nnpm ERR! 404 Not Found");
    expect(notes).toContain("Run npm install yourself");
    // install stays in Next steps since it did not succeed
    expect(p.notes.at(-1)).toContain("npm install");
  });

  it("the latest output line is what the spinner shows: last non-empty line, colours stripped, trimmed", () => {
    expect(lastOutputLine("")).toBeUndefined();
    expect(lastOutputLine("\n\n")).toBeUndefined();
    expect(lastOutputLine("a\nb\n\n")).toBe("b");
    expect(lastOutputLine("a\r\n\x1b[32madded 1 package\x1b[0m\r\n")).toBe("added 1 package");
    expect(lastOutputLine(`${"x".repeat(100)}\n`)).toBe(`${"x".repeat(79)}…`);
  });

  it("a missing `code` command is explained, not thrown", async () => {
    const dir = join(await tmp(), "app");
    const p = scripted({ select: ["empty"], groupMultiselect: [["vscode"]], confirm: [true, true] });
    const { launcher } = recordingLauncher({ code: "not-found" });
    const code = await runFlow({ dir, provider: "none" }, { interactive: true, prompter: p, launcher });
    expect(code).toBe(0);
    expect(p.notes.join("\n")).toContain("`code` command");
  });
});

describe("resolveScaffoldOptions — agents step", () => {
  it("carries the ticked agents out of the setup list (VS Code unticked = no editor)", async () => {
    const p = scripted({ select: ["starter"], groupMultiselect: [["claude", "agents-md"]] , confirm: [true] });
    const out = await resolveScaffoldOptions({ dir: "d", interactive: true, provider: "none" }, p);
    expect(out).toEqual({
      kind: "scaffold",
      dir: "d",
      template: "starter",
      force: false,
      provider: "none",
      ide: "none",
      agents: ["claude", "agents-md"],
    });
  });

  it("the add path asks the agents question too", async () => {
    const cwd = await tmp();
    await writeFile(join(cwd, "package.json"), '{"name":"my-api"}');
    const p = scripted({ select: ["add"], groupMultiselect: [["agents-md"]] , confirm: [true] });
    const out = await resolveScaffoldOptions({ interactive: true, provider: "none", cwd }, p);
    expect(out).toEqual({ kind: "add", dir: cwd, provider: "none", ide: "none", agents: ["agents-md"] });
  });

  it("--agents drops the agents group; only the editor half is asked (comma list)", async () => {
    const p = scripted({ select: ["starter"], groupMultiselect: [["vscode"]] , confirm: [true] });
    const asked: string[] = [];
    const inner = p.groupMultiselect;
    p.groupMultiselect = (m, groups, initial) => {
      asked.push(`${m}|${groups.map((g) => g.label).join("+")}|${initial.join(",")}`);
      return inner(m, groups, initial);
    };
    const out = await resolveScaffoldOptions({ dir: "d", agents: "cursor,copilot", interactive: true, provider: "none" }, p);
    expect(out).toMatchObject({ kind: "scaffold", ide: "vscode", agents: ["cursor", "copilot"] });
    expect(asked).toEqual([`${SETUP_LIST_QUESTION}|Editor|vscode`]);
  });

  it("--agents none plus --ide none: nothing is asked", async () => {
    const out = await resolveScaffoldOptions(
      { dir: "d", template: "starter", ide: "none", agents: "none", interactive: true, provider: "none" },
      scripted({}),
    );
    expect(out).toMatchObject({ kind: "scaffold", agents: [] });
  });

  it("rejects an invalid --agents id listing valid values", async () => {
    await expect(
      resolveScaffoldOptions({ dir: "d", agents: "emacs", interactive: false }, scripted({})),
    ).rejects.toThrow(/invalid --agents "emacs".*claude.*agents-md/);
  });

  it("non-interactive default is none", async () => {
    const out = await resolveScaffoldOptions({ interactive: false }, scripted({}));
    expect(out).toMatchObject({ kind: "scaffold", agents: [] });
  });

  it("cancelling the setup list (after a yes at the gate) cancels the flow too", async () => {
    const p = scripted({ select: ["starter"], confirm: [true] }); // group queue empty -> null
    const out = await resolveScaffoldOptions({ dir: "d", interactive: true, provider: "none" }, p);
    expect(out).toEqual({ kind: "cancelled" });
  });
});

describe("runFlow — agents step", () => {
  it("writes the adapters when the scaffold outcome carries agents", async () => {
    const dir = join(await tmp(), "app");
    const code = await runFlow(
      { dir, template: "empty", agents: "claude,agents-md" },
      { interactive: false, prompter: scripted({}) },
    );
    expect(code).toBe(0);
    expect(existsSync(join(dir, ".claude", "skills", "nola", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(dir, ".cursor"))).toBe(false);
  });

  it("writes adapters on add mode and reports an existing AGENTS.md as skipped", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "package.json"), '{"name":"existing-api"}\n');
    await writeFile(join(dir, "AGENTS.md"), "# Existing\n");
    const p = scripted({});
    const code = await runFlow({ dir, add: true, agents: "agents-md,cursor" }, { interactive: false, prompter: p });
    expect(code).toBe(0);
    expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toBe("# Existing\n");
    expect(existsSync(join(dir, ".cursor", "rules", "nola.mdc"))).toBe(true);
    expect(p.notes.join("\n")).toContain("AGENTS.md already exists");
  });

  it("non-interactive without --agents writes no adapters (unchanged default)", async () => {
    const dir = join(await tmp(), "app");
    await runFlow({ dir, template: "empty" }, { interactive: false, prompter: scripted({}) });
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(dir, ".claude"))).toBe(false);
  });
});

describe("runFlow — next steps follow the invoking package manager", () => {
  it("defaults to npm", async () => {
    const dir = join(await tmp(), "app");
    const p = scripted({});
    await runFlow({ dir, template: "starter" }, { interactive: false, prompter: p });
    expect(p.notes.join("\n")).toContain("npm install\n  npm start");
  });

  it("spells pnpm/yarn/bun when that manager ran the scaffolder", async () => {
    for (const pm of ["pnpm", "yarn", "bun"] as const) {
      const dir = join(await tmp(), "app");
      const p = scripted({});
      await runFlow({ dir, template: "empty" }, { interactive: false, prompter: p, packageManager: pm });
      const text = p.notes.join("\n");
      expect(text).toContain(`${pm} install\n  ${pm} start`);
      expect(text).not.toMatch(/\bnpm /);
    }
  });

  it("add mode follows the manager too", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "package.json"), '{"name":"existing-api"}\n');
    const p = scripted({});
    await runFlow({ dir, add: true }, { interactive: false, prompter: p, packageManager: "pnpm" });
    expect(p.notes.join("\n")).toContain("pnpm install");
    expect(p.notes.join("\n")).not.toMatch(/\bnpm /);
  });

  it("ends with the console suggestion — the start line and the console line share one comment column", async () => {
    const dir = join(await tmp(), "app");
    const p = scripted({});
    await runFlow({ dir, template: "starter" }, { interactive: false, prompter: p });
    const outro = p.notes.at(-1) ?? "";
    expect(outro).toContain(
      "npm start              # runs offline — no API key needed\n  npx nola-lang console  # trace every ask in your browser (it prints the config line to add)",
    );
    expect(outro.trimEnd().endsWith("(it prints the config line to add)")).toBe(true);
  });

  it("add mode suggests the console too", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "package.json"), '{"name":"existing-api"}\n');
    const p = scripted({});
    await runFlow({ dir, add: true }, { interactive: false, prompter: p });
    expect(p.notes.at(-1)).toContain("npx nola-lang console  # trace every ask in your browser");
  });
});

describe("runFlow — add mode", () => {
  it("executes add mode end-to-end on an existing project", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "package.json"), '{"name":"existing-api"}\n');
    const code = await runFlow({ dir, add: true }, { interactive: false, prompter: scripted({}) });
    expect(code).toBe(0);
    expect(existsSync(join(dir, "nola.config.ts"))).toBe(true);
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(pkg.devDependencies["nola-lang"]).toMatch(/^\^/);
  });

  it("second run reports the project already has Nola", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "package.json"), '{"name":"existing-api"}\n');
    await runFlow({ dir, add: true }, { interactive: false, prompter: scripted({}) });
    const p = scripted({});
    const code = await runFlow({ dir, add: true }, { interactive: false, prompter: p });
    expect(code).toBe(0);
    expect(p.notes.join("\n")).toContain("already has Nola");
  });
});

const KEY = `nola_sk_${"c".repeat(40)}`;

/** A fetch that answers POST /v1/trial; records the bodies. */
const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const AT = jwt({ sub: "auth0|1", "nola:account_id": "acct_u" });
const AT2 = jwt({ sub: "auth0|1", "nola:account_id": "acct_u", n: 2 });
const RT = "rt-refresh";
const ID_TOKEN = `h.${Buffer.from(JSON.stringify({ email: "dev@example.com" })).toString("base64url")}.s`;
const KEY2 = `nola_sk_${"b".repeat(40)}`;
const CAPS = { protocol: 1, infer: true, ingest: false, auth: { issuer: "https://api.nola.sh", clientId: "cli", audience: "aud", redirectPorts: [0] } };

/** A stand-in browser: comes straight back to the CLI's loopback callback with a code and the right state. */
function approvingBrowser(opened: string[] = []) {
  return (url: string) => {
    opened.push(url);
    const u = new URL(url);
    void globalThis.fetch(`${u.searchParams.get("redirect_uri")}?code=ac&state=${u.searchParams.get("state")}`).catch(() => undefined);
    return true;
  };
}

type Reply = { status?: number; body?: unknown } | Error;
/** A stub of the API and the "tenant" (same host in tests). Per-path overrides; every call is recorded. */
function trialFetch(arg: Record<string, Reply> | Reply = {}) {
  // the old one-argument shape (a reply or an Error) means "override /v1/trial"
  const overrides: Record<string, Reply> = arg instanceof Error || "status" in arg || "body" in arg ? { "/v1/trial": arg as Reply } : (arg as Record<string, Reply>);
  const calls: { url: string; path: string; body: unknown; authorization?: string }[] = [];
  const fn = (async (url: unknown, init: unknown) => {
    const i = init as RequestInit;
    const headers = i.headers as Record<string, string>;
    const path = new URL(String(url)).pathname;
    const raw = i.body ? String(i.body) : undefined;
    const body = raw === undefined ? undefined : headers["content-type"]?.includes("json") ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
    calls.push({ url: String(url), path, body, authorization: headers.authorization });
    const r = overrides[path];
    if (r instanceof Error) throw r;
    if (r?.body !== undefined || r?.status !== undefined) {
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
    }
    const defaults: Record<string, { status: number; body: unknown }> = {
      "/v1/trial": { status: 201, body: { apiKey: KEY, account: { id: "acct_1", kind: "anonymous" }, trial: { runs: 25 } } },
      "/v1/capabilities": { status: 200, body: CAPS },
      "/oauth/token": { status: 200, body: { access_token: AT, refresh_token: RT, expires_in: 3600, id_token: ID_TOKEN, token_type: "Bearer" } },
      "/v1/console/keys": { status: 201, body: { id: "key_2", name: "cli", prefix: "nola_sk_bb", suffix: "bbbbbbbb", apiKey: KEY2 } },
    };
    const d = defaults[path] ?? { status: 404, body: { error: { code: "not_found", message: `no route ${path}` } } };
    return new Response(JSON.stringify(d.body), { status: d.status });
  }) as typeof globalThis.fetch;
  return { fn, calls };
}

async function seedSession(home: string, apiUrl = "https://api.nola.sh", accessToken = AT2) {
  await mkdir(join(home, ".nola"), { recursive: true });
  await writeFile(
    join(home, ".nola", CREDENTIALS_FILE),
    JSON.stringify({
      version: 1,
      sessions: { [apiUrl]: { accessToken, refreshToken: RT, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), email: "dev@example.com" } },
    }),
  );
}
async function seedConfig(home: string, apiUrl = "https://api.nola.sh") {
  await mkdir(join(home, ".nola"), { recursive: true });
  await writeFile(
    join(home, ".nola", HOME_CONFIG_FILE),
    JSON.stringify({ version: 1, accounts: { [apiUrl]: { accountId: "acct_old", issuedAt: "2026-09-01T08:00:00.000Z" } } }),
  );
}
const sessionOf = async (home: string) => JSON.parse(await readFile(join(home, ".nola", CREDENTIALS_FILE), "utf8"));

describe("wizard order", () => {
  /** Every prompt in the order it was shown, with the preselection where one exists. */
  function recording(p: Prompter): string[] {
    const asked: string[] = [];
    const { text, select, confirm, multiselect, groupMultiselect } = p;
    p.text = (m, i) => {
      asked.push(`${m}|${i}`);
      return text(m, i);
    };
    p.select = (m, o) => {
      asked.push(m);
      return select(m, o);
    };
    p.confirm = (m, i) => {
      asked.push(`${m}|${i}`);
      return confirm(m, i);
    };
    p.multiselect = (m, o, i) => {
      asked.push(`${m}|${i.join(",")}`);
      return multiselect(m, o, i);
    };
    p.groupMultiselect = (m, g, i) => {
      asked.push(`${m}|${g.map((x) => x.label).join("+")}|${i.join(",")}`);
      return groupMultiselect(m, g, i);
    };
    return asked;
  }

  it("asks name, template, the inference provider, the setup gate, then ONE setup list (editor + agents, VS Code and Claude Code preselected)", async () => {
    const p = scripted({ text: ["app"], select: ["starter", "nola"], groupMultiselect: [["vscode", "claude"]], confirm: [true] });
    const asked = recording(p);
    const out = await resolveScaffoldOptions({ interactive: true, cwd: await tmp() }, p);
    expect(asked).toEqual([
      `${NAME_QUESTION}|nola-app`,
      "Select a template:",
      PROVIDER_QUESTION,
      `${SETUP_QUESTION}|true`,
      `${SETUP_LIST_QUESTION}|Editor+Coding agents|vscode,claude`,
    ]);
    expect(out).toEqual({
      kind: "scaffold",
      dir: "app",
      template: "starter",
      force: false,
      provider: "nola",
      ide: "vscode",
      agents: ["claude"],
    });
  });

  it("a no at the gate skips the list: no editor, no agents, nothing else asked", async () => {
    const p = scripted({ select: ["starter"], confirm: [false] });
    const asked = recording(p);
    const out = await resolveScaffoldOptions({ dir: "d", interactive: true, provider: "none" }, p);
    expect(asked).toEqual(["Select a template:", `${SETUP_QUESTION}|true`]);
    expect(out).toEqual({ kind: "scaffold", dir: "d", template: "starter", force: false, provider: "none", ide: "none", agents: [] });
  });

  it("a no at a narrowed gate keeps the flag's half", async () => {
    const p = scripted({ select: ["starter"], confirm: [false] });
    const asked = recording(p);
    const out = await resolveScaffoldOptions({ dir: "d", agents: "cursor", interactive: true, provider: "none" }, p);
    expect(asked).toEqual(["Select a template:", `${EDITOR_QUESTION}|true`]);
    expect(out).toMatchObject({ kind: "scaffold", ide: "none", agents: ["cursor"] });
  });

  it("the name prompt says Enter keeps the default", () => {
    expect(NAME_QUESTION).toMatch(/Enter/);
    expect(NAME_QUESTION).toContain("nola-app");
  });

  it("the add path follows the same order: provider, then setup", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "package.json"), '{"name":"x"}');
    const p = scripted({ select: ["none"], groupMultiselect: [[]], confirm: [true] });
    const asked = recording(p);
    const out = await resolveScaffoldOptions({ add: true, dir, interactive: true }, p);
    expect(asked).toEqual([PROVIDER_QUESTION, `${SETUP_QUESTION}|true`, `${SETUP_LIST_QUESTION}|Editor+Coding agents|vscode,claude`]);
    expect(out).toEqual({ kind: "add", dir, provider: "none", ide: "none", agents: [] });
  });
});

describe("provider question", () => {
  /** The select options shown for each question, in order. */
  function recordOptions(p: Prompter): Record<string, PrompterOption[]> {
    const shown: Record<string, PrompterOption[]> = {};
    const select = p.select;
    p.select = (m, o) => {
      shown[m] = o;
      return select(m, o);
    };
    return shown;
  }

  it("lists nola (first), the three vendors and skip, in that order, and lands the choice on the outcome", async () => {
    const p = scripted({ text: ["app"], select: ["starter", "anthropic"], confirm: [false] });
    const shown = recordOptions(p);
    const out = await resolveScaffoldOptions({ interactive: true, cwd: await tmp() }, p);
    expect(out).toMatchObject({ kind: "scaffold", template: "starter", provider: "anthropic" });
    expect(shown[PROVIDER_QUESTION]?.map((o) => `${o.value}|${o.label}`)).toEqual([
      "nola|Nola",
      "openai|OpenAI",
      "anthropic|Anthropic",
      "google|Gemini",
      "none|Skip for now",
    ]);
    expect(shown[PROVIDER_QUESTION]?.[0]?.hint).toBe("25 free runs, no account or provider key needed");
  });

  it("the nola row's hint follows the machine: sign in once the trial is used, a key on the account when signed in — and no network before a choice", async () => {
    const hints: string[] = [];
    const record = (p: Prompter) => {
      const select = p.select;
      p.select = (m, o) => {
        if (m === PROVIDER_QUESTION) hints.push(o[0]?.hint ?? "");
        return select(m, o);
      };
      return p;
    };
    const used = await tmp();
    await seedConfig(used);
    const a = trialFetch();
    expect(
      await runFlow(
        { dir: join(await tmp(), "app"), template: "empty" },
        { interactive: true, prompter: record(scripted({ select: ["none"], confirm: [false] })), fetch: a.fn, home: used, apiUrl: "https://api.nola.sh" },
      ),
    ).toBe(0);
    const signed = await tmp();
    await seedSession(signed);
    const b = trialFetch();
    expect(
      await runFlow(
        { dir: join(await tmp(), "app"), template: "empty" },
        { interactive: true, prompter: record(scripted({ select: ["none"], confirm: [false] })), fetch: b.fn, home: signed, apiUrl: "https://api.nola.sh" },
      ),
    ).toBe(0);
    expect(hints).toEqual([
      "Trial key already issued. Get another? Enter to sign in.",
      "a key on your Nola account (signed in as dev@example.com)",
    ]);
    expect(nolaHint({ kind: "account", email: null })).toBe("a key on your Nola account (signed in)");
    expect([...a.calls, ...b.calls]).toEqual([]);
  });

  it("is skipped by --provider, by the --trial / --no-trial shorthands, and defaults to none non-interactively", async () => {
    const flagged = await resolveScaffoldOptions(
      { dir: "d", template: "empty", provider: "google", interactive: true },
      scripted({ groupMultiselect: [[]], confirm: [true] }),
    );
    expect(flagged).toMatchObject({ provider: "google" });
    const yes = await resolveScaffoldOptions(
      { dir: "d", template: "empty", trial: true, interactive: true },
      scripted({ groupMultiselect: [[]], confirm: [true] }),
    );
    expect(yes).toMatchObject({ provider: "nola" });
    const no = await resolveScaffoldOptions(
      { dir: "d", template: "empty", trial: false, interactive: true },
      scripted({ groupMultiselect: [[]], confirm: [true] }),
    );
    expect(no).toMatchObject({ provider: "none" });
    const plain = await resolveScaffoldOptions({ interactive: false }, scripted({}));
    expect(plain).toMatchObject({ kind: "scaffold", provider: "none" });
  });

  it("rejects an unknown --provider listing the valid ids, and --provider disagreeing with --trial", async () => {
    await expect(resolveScaffoldOptions({ dir: "d", provider: "mistral", interactive: false }, scripted({}))).rejects.toThrow(
      /invalid --provider "mistral".*nola, openai, anthropic, google, none/,
    );
    await expect(resolveScaffoldOptions({ dir: "d", provider: "openai", trial: true, interactive: false }, scripted({}))).rejects.toThrow(
      /--trial.*--provider/,
    );
    // agreeing shorthands are fine
    expect(await resolveScaffoldOptions({ dir: "d", provider: "nola", trial: true, interactive: false }, scripted({}))).toMatchObject({ provider: "nola" });
  });

  it("is asked on the add path too, and Ctrl-C there cancels", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "package.json"), '{"name":"x"}');
    const out = await resolveScaffoldOptions({ add: true, dir, interactive: true }, scripted({ select: ["nola"], confirm: [true], groupMultiselect: [[]] }));
    expect(out).toMatchObject({ kind: "add", provider: "nola" });
    const cancelled = await resolveScaffoldOptions({ add: true, dir, interactive: true }, scripted({ select: [null] }));
    expect(cancelled).toEqual({ kind: "cancelled" });
  });
});

describe("runFlow with a vendor provider", () => {
  it("writes that vendor's config, no ledger, no network, and the outro names the env var", async () => {
    const dir = join(await tmp(), "app");
    const { fn, calls } = trialFetch();
    const p = scripted({});
    expect(await runFlow({ dir, template: "starter", provider: "anthropic" }, { interactive: false, prompter: p, fetch: fn, home: await tmp() })).toBe(0);
    expect(calls).toEqual([]);
    expect(await readFile(join(dir, "nola.config.ts"), "utf8")).toContain('model: anthropic("claude-sonnet-4-5")');
    expect(existsSync(join(dir, "nola.replay.jsonl"))).toBe(false);
    expect(existsSync(join(dir, ".env"))).toBe(false);
    expect(p.notes.at(-1)).toContain("npm start              # set ANTHROPIC_API_KEY in .env first");
  });

  it("on the add path writes the vendor config when the project has none, and only names the model line when it has one", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "package.json"), '{"name":"existing"}\n');
    const p = scripted({});
    expect(await runFlow({ dir, add: true, provider: "google" }, { interactive: false, prompter: p })).toBe(0);
    expect(await readFile(join(dir, "nola.config.ts"), "utf8")).toContain('model: google("gemini-2.5-flash")');
    expect(p.notes.at(-1)).toMatch(/Added Nola: nola\.config\.ts, package\.json/);

    const dir2 = await tmp();
    await writeFile(join(dir2, "package.json"), '{"name":"has-config"}\n');
    await writeFile(join(dir2, "nola.config.ts"), "export default {};\n");
    const p2 = scripted({});
    expect(await runFlow({ dir: dir2, add: true, provider: "google" }, { interactive: false, prompter: p2 })).toBe(0);
    expect(await readFile(join(dir2, "nola.config.ts"), "utf8")).toBe("export default {};\n");
    expect(p2.notes.some((n) => n.includes('model: google("gemini-2.5-flash")'))).toBe(true);
  });
});

describe("runFlow with the nola provider", () => {
  it('sends an EMPTY trial body, records the account in ~/.nola/config.json (and nothing else), scaffolds without the ledger, writes .env and the nola.infer() config', async () => {
    const dir = join(await tmp(), "app");
    const home = await tmp();
    const { fn, calls } = trialFetch();
    const p = scripted({});
    const code = await runFlow(
      { dir, template: "starter", provider: "nola" },
      { interactive: false, prompter: p, fetch: fn, home, apiUrl: "https://api.nola.sh" },
    );
    expect(code).toBe(0);
    expect(calls.map((c) => c.path)).toEqual(["/v1/trial"]);
    expect(calls[0]?.body).toEqual({});
    expect(JSON.parse(await readFile(join(home, ".nola", HOME_CONFIG_FILE), "utf8"))).toEqual({
      version: 1,
      accounts: { "https://api.nola.sh": { accountId: "acct_1", issuedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/) } },
    });
    expect(existsSync(join(home, ".nola", CREDENTIALS_FILE))).toBe(false);
    expect(await readFile(join(dir, ".env"), "utf8")).toBe(`NOLA_API_KEY=${KEY}\n`);
    expect(await readFile(join(dir, "nola.config.ts"), "utf8")).toContain("model: nola.infer()");
    expect(existsSync(join(dir, "nola.replay.jsonl"))).toBe(false);
    expect((await readFile(join(dir, ".gitignore"), "utf8")).split("\n")).toEqual(expect.arrayContaining([".env", ".env.*"]));
    expect(p.notes.at(-1)).toContain("# 25 free Nola runs — key in .env");
  });
  it("a machine that used its trial, non-interactive: NO network, the sign-in note, the plain template", async () => {
    const dir = join(await tmp(), "app");
    const home = await tmp();
    await seedConfig(home);
    const { fn, calls } = trialFetch();
    const p = scripted({});
    expect(
      await runFlow(
        { dir, template: "starter", provider: "nola" },
        { interactive: false, prompter: p, fetch: fn, home, apiUrl: "https://api.nola.sh" },
      ),
    ).toBe(0);
    expect(calls).toEqual([]);
    expect(p.notes).toContain(
      "This machine already used its 25 free Nola runs. Sign in with `npx nola-lang login` to get an API key for this project.",
    );
    expect(existsSync(join(dir, ".env"))).toBe(false);
    expect(existsSync(join(dir, "nola.replay.jsonl"))).toBe(true);
    expect(JSON.parse(await readFile(join(home, ".nola", HOME_CONFIG_FILE), "utf8")).accounts["https://api.nola.sh"].accountId).toBe("acct_old");
  });
  it("signed in: mints on /v1/console/keys with the access token, no trial, account outro", async () => {
    const dir = join(await tmp(), "app");
    const home = await tmp();
    await seedSession(home);
    await seedConfig(home);
    const { fn, calls } = trialFetch();
    const p = scripted({});
    expect(
      await runFlow(
        { dir, template: "starter", provider: "nola" },
        { interactive: false, prompter: p, fetch: fn, home, apiUrl: "https://api.nola.sh" },
      ),
    ).toBe(0);
    expect(calls.map((c) => c.path)).toEqual(["/v1/console/keys"]);
    expect(calls[0]?.authorization).toBe(`Bearer ${AT2}`);
    expect(calls[0]?.body).toEqual({ name: "cli" });
    expect(await readFile(join(dir, ".env"), "utf8")).toBe(`NOLA_API_KEY=${KEY2}\n`);
    expect(existsSync(join(dir, "nola.replay.jsonl"))).toBe(false);
    expect(p.notes.at(-1)).toContain("# key in .env (run `npx nola-lang account` to check the balance)");
    expect(p.notes.join("\n")).not.toContain(AT2);
  });
  it("interactive on a used machine: Enter on the Nola row runs the PKCE sign-in RIGHT THERE (browser before the setup gate) with the recorded trial account as the hint, the session is stored, the key comes from the console", async () => {
    const dir = join(await tmp(), "app");
    const home = await tmp();
    await seedConfig(home);
    const { fn, calls } = trialFetch();
    const opened: string[] = [];
    const events: string[] = [];
    const p = scripted({ select: ["nola"], confirm: [false] });
    const select = p.select;
    p.select = (m, o) => {
      events.push(`select:${m}`);
      return select(m, o);
    };
    const confirm = p.confirm;
    p.confirm = (m, i) => {
      events.push(`confirm:${m}`);
      return confirm(m, i);
    };
    const browser = approvingBrowser(opened);
    const open = (url: string) => {
      events.push("browser");
      return browser(url);
    };
    expect(await runFlow({ dir, template: "empty" }, { interactive: true, prompter: p, fetch: fn, home, apiUrl: "https://api.nola.sh", open })).toBe(0);
    expect(events).toEqual([`select:${PROVIDER_QUESTION}`, "browser", `confirm:${SETUP_QUESTION}`]);
    expect(calls.map((c) => c.path)).toEqual(["/v1/capabilities", "/oauth/token", "/v1/console/keys"]);
    expect(calls[1]?.body).toMatchObject({ grant_type: "authorization_code", client_id: "cli", code: "ac" });
    expect(calls[2]?.authorization).toBe(`Bearer ${AT}`);
    expect(opened).toHaveLength(1);
    const authorize = new URL(opened[0] as string);
    expect(`${authorize.origin}${authorize.pathname}`).toBe("https://api.nola.sh/authorize");
    expect(authorize.searchParams.get("ext-nola_account")).toBe("acct_old");
    expect(p.notes).toEqual(expect.arrayContaining([`Sign in to Nola: open ${opened[0]}`, "Waiting for the browser…", "Signed in as dev@example.com."]));
    expect((await sessionOf(home)).sessions["https://api.nola.sh"]).toEqual({
      accessToken: AT,
      refreshToken: RT,
      expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      email: "dev@example.com",
    });
    expect(await readFile(join(dir, ".env"), "utf8")).toBe(`NOLA_API_KEY=${KEY2}\n`);
    expect(p.notes.join("\n")).not.toContain(AT);
  });
  it("a sign-in that fails at the Nola row notes why and asks for the provider again; skip then scaffolds plain, no key", async () => {
    const dir = join(await tmp(), "app");
    const home = await tmp();
    await seedConfig(home);
    // the server offers no sign-in: capabilities without `auth`
    const { fn, calls } = trialFetch({ "/v1/capabilities": { status: 200, body: { protocol: 1, infer: true, ingest: false } } });
    const asked: string[] = [];
    const p = scripted({ select: ["nola", "none"], confirm: [false] });
    const select = p.select;
    p.select = (m, o) => {
      asked.push(m);
      return select(m, o);
    };
    expect(await runFlow({ dir, template: "starter" }, { interactive: true, prompter: p, fetch: fn, home, apiUrl: "https://api.nola.sh", open: () => true })).toBe(0);
    expect(asked).toEqual([PROVIDER_QUESTION, PROVIDER_QUESTION]);
    expect(calls.map((c) => c.path)).toEqual(["/v1/capabilities"]);
    expect(p.notes.some((n) => n.startsWith("Could not sign in to Nola:"))).toBe(true);
    expect(existsSync(join(dir, ".env"))).toBe(false);
    expect(existsSync(join(dir, "nola.replay.jsonl"))).toBe(true);
  });
  it("a session the server rejects (401) is deleted; non-interactive then gets the sign-in note, no trial", async () => {
    const dir = join(await tmp(), "app");
    const home = await tmp();
    await seedSession(home);
    await seedConfig(home);
    const { fn, calls } = trialFetch({ "/v1/console/keys": { status: 401, body: { error: { code: "unauthorized", message: "Your session is not valid. Sign in again." } } } });
    const p = scripted({});
    expect(
      await runFlow(
        { dir, template: "starter", provider: "nola" },
        { interactive: false, prompter: p, fetch: fn, home, apiUrl: "https://api.nola.sh" },
      ),
    ).toBe(0);
    expect(calls.map((c) => c.path)).toEqual(["/v1/console/keys"]);
    expect((await sessionOf(home)).sessions).toEqual({});
    expect(p.notes.some((n) => n.startsWith("This machine already used its 25 free Nola runs."))).toBe(true);
    expect(existsSync(join(dir, ".env"))).toBe(false);

    // any other console failure: the failure note with the retry hint, plain template, session kept
    const dir2 = join(await tmp(), "app");
    const home2 = await tmp();
    await seedSession(home2);
    const boom = trialFetch({ "/v1/console/keys": { status: 500, body: { error: { code: "internal", message: "boom" } } } });
    const p2 = scripted({});
    expect(
      await runFlow(
        { dir: dir2, template: "starter", provider: "nola" },
        { interactive: false, prompter: p2, fetch: boom.fn, home: home2, apiUrl: "https://api.nola.sh" },
      ),
    ).toBe(0);
    const note = p2.notes.find((n) => n.startsWith("Could not get a Nola API key")) ?? "";
    expect(note).toContain("boom");
    expect(note).toContain("npx nola-lang key");
    expect((await sessionOf(home2)).sessions["https://api.nola.sh"].accessToken).toBe(AT2);
    expect(existsSync(join(dir2, "nola.replay.jsonl"))).toBe(true);
  });

  it("the add path mints on the account too when signed in", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "package.json"), '{"name":"existing"}\n');
    const home = await tmp();
    await seedSession(home);
    const { fn, calls } = trialFetch();
    expect(
      await runFlow(
        { dir, add: true, provider: "nola" },
        { interactive: false, prompter: scripted({}), fetch: fn, home, apiUrl: "https://api.nola.sh" },
      ),
    ).toBe(0);
    expect(calls.map((c) => c.path)).toEqual(["/v1/console/keys"]);
    expect(await readFile(join(dir, ".env"), "utf8")).toBe(`NOLA_API_KEY=${KEY2}\n`);
  });
  it("falls back to the plain scaffold, exit 0, with the reason and the retry hint when the API refuses — and records nothing", async () => {
    const dir = join(await tmp(), "app");
    const home = await tmp();
    const { fn } = trialFetch({ status: 429, body: { error: { code: "rate_limited", message: "Too many trial sign-ups." } } });
    const p = scripted({});
    const code = await runFlow({ dir, template: "starter", provider: "nola" }, { interactive: false, prompter: p, fetch: fn, home });
    expect(code).toBe(0);
    expect(existsSync(join(home, ".nola", HOME_CONFIG_FILE))).toBe(false);
    expect(existsSync(join(dir, ".env"))).toBe(false);
    expect(existsSync(join(dir, "nola.replay.jsonl"))).toBe(true);
    expect(await readFile(join(dir, "nola.config.ts"), "utf8")).toContain('replay("./nola.replay.jsonl")');
    const note = p.notes.find((n) => n.startsWith("Could not get a Nola API key"));
    expect(note).toContain("Too many trial sign-ups.");
    expect(note).toContain("npx nola-lang key");
    expect(p.notes.at(-1)).toContain("runs offline — no API key needed");
  });

  it("falls back the same way when offline", async () => {
    const dir = join(await tmp(), "app");
    const { fn } = trialFetch(new Error("ENOTFOUND"));
    const p = scripted({});
    expect(
      await runFlow({ dir, template: "empty", provider: "nola" }, { interactive: false, prompter: p, fetch: fn, home: await tmp() }),
    ).toBe(0);
    expect(p.notes.some((n) => n.includes("Could not reach the Nola API"))).toBe(true);
    expect(await readFile(join(dir, "nola.config.ts"), "utf8")).toContain("openai(");
  });

  it("on the add path writes .env and the trial config, and only notes an existing config", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "package.json"), '{"name":"existing"}\n');
    const { fn } = trialFetch();
    const p = scripted({});
    expect(await runFlow({ dir, add: true, provider: "nola" }, { interactive: false, prompter: p, fetch: fn, home: await tmp() })).toBe(0);
    expect(await readFile(join(dir, ".env"), "utf8")).toBe(`NOLA_API_KEY=${KEY}\n`);
    expect(await readFile(join(dir, "nola.config.ts"), "utf8")).toContain("model: nola.infer()");
    expect(p.notes.at(-1)).toMatch(/Added Nola: nola\.config\.ts, package\.json, .*\.env/);

    // second project with its own config: the key is written, the config is left alone and named
    const dir2 = await tmp();
    await writeFile(join(dir2, "package.json"), '{"name":"has-config"}\n');
    await writeFile(join(dir2, "nola.config.ts"), "export default {};\n");
    const p2 = scripted({});
    expect(await runFlow({ dir: dir2, add: true, provider: "nola" }, { interactive: false, prompter: p2, fetch: fn, home: await tmp() })).toBe(0);
    expect(await readFile(join(dir2, "nola.config.ts"), "utf8")).toBe("export default {};\n");
    expect(p2.notes.some((n) => n.includes("model: nola.infer()"))).toBe(true);
    expect(await readFile(join(dir2, ".env"), "utf8")).toBe(`NOLA_API_KEY=${KEY}\n`);
  });

  it("a 429 with Retry-After tells the user how long to wait", async () => {
    const dir = join(await tmp(), "app");
    const fn = (async () =>
      new Response(JSON.stringify({ error: { code: "rate_limited", message: "Too many." } }), {
        status: 429,
        headers: { "retry-after": "90" },
      })) as typeof globalThis.fetch;
    const p = scripted({});
    await runFlow({ dir, template: "empty", provider: "nola" }, { interactive: false, prompter: p, fetch: fn, home: await tmp() });
    const note = p.notes.find((n) => n.startsWith("Could not get a Nola API key")) ?? "";
    expect(note).toContain("too many trials from this network — try again in 90 s");
  });

  it("a long Retry-After is stated in hours or minutes, not raw seconds", async () => {
    const limited = (secs: number) =>
      (async () =>
        new Response(JSON.stringify({ error: { code: "rate_limited", message: "Trial limit reached for this address today." } }), {
          status: 429,
          headers: { "retry-after": String(secs) },
        })) as typeof globalThis.fetch;
    const noteFor = async (secs: number) => {
      const dir = join(await tmp(), "app");
      const p = scripted({});
      await runFlow({ dir, template: "empty", provider: "nola" }, { interactive: false, prompter: p, fetch: limited(secs), home: await tmp() });
      return p.notes.find((n) => n.startsWith("Could not get a Nola API key")) ?? "";
    };
    // the one users actually hit: a per-address daily limit, reported as ~14 h of seconds
    expect(await noteFor(49832)).toContain("try again in about 14 hours");
    expect(await noteFor(300)).toContain("try again in about 5 minutes");
    expect(await noteFor(3600)).toContain("try again in about 1 hour");
  });
});
