import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkoutRoot } from "../src/checkout.js";
import { CREDENTIALS_FILE } from "../src/credentials.js";
import {
  BACK,
  EXAMPLE_QUESTION,
  exampleMenu,
  INSTALL_OPEN_QUESTION,
  INSTALL_QUESTION,
  lastOutputLine,
  MORE_EXAMPLES,
  NAME_QUESTION,
  nolaHint,
  PROVIDER_QUESTION,
  type Prompter,
  type PrompterOption,
  providerOptions,
  resolveScaffoldOptions,
  runFlow,
  SETUP_QUESTION,
  TEMPLATE_QUESTION,
  templateMenu,
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

/** Records every prompt (message|initial) the flow asks, in order. */
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

describe("resolveScaffoldOptions", () => {
  it("prompts name then template when nothing is given", async () => {
    const p = scripted({ text: ["my-proj"], select: ["empty"] });
    const out = await resolveScaffoldOptions({ interactive: true, provider: "none", cwd: await tmp() }, p);
    expect(out).toEqual({
      kind: "scaffold",
      dir: "my-proj",
      template: "empty",
      force: false,
      provider: "none",
      ide: "vscode",
      agents: ["claude", "universal"],
    });
  });

  it("skips the name prompt when dir is given, the template prompt when --template is given", async () => {
    const p = scripted({});
    const out = await resolveScaffoldOptions({ dir: "given-dir", template: "typescript-interop", interactive: true, provider: "none" }, p);
    expect(out).toEqual({
      kind: "scaffold",
      dir: "given-dir",
      template: "typescript-interop",
      force: false,
      provider: "none",
      ide: "vscode",
      agents: ["claude", "universal"],
    });
  });

  it("applies defaults non-interactively", async () => {
    const out = await resolveScaffoldOptions({ interactive: false }, scripted({}));
    expect(out).toEqual({
      kind: "scaffold",
      dir: "nola-app",
      template: "feature-extraction",
      force: false,
      provider: "none",
      ide: "vscode",
      agents: ["claude", "universal"],
    });
  });

  it("empty name answer falls back to the default", async () => {
    const p = scripted({ text: ["   "], select: ["typescript-interop"] });
    const out = await resolveScaffoldOptions({ interactive: true, provider: "none", cwd: await tmp() }, p);
    expect(out).toMatchObject({ kind: "scaffold", dir: "nola-app" });
  });

  it("cancelling the name prompt cancels the flow", async () => {
    const out = await resolveScaffoldOptions({ interactive: true, provider: "none", cwd: await tmp() }, scripted({ text: [null] }));
    expect(out).toEqual({ kind: "cancelled" });
  });

  it("rejects an unknown --template non-interactively, listing valid names", async () => {
    await expect(resolveScaffoldOptions({ dir: "d", template: "nope", interactive: false }, scripted({}))).rejects.toThrow(
      /unknown template "nope".*typescript-interop/,
    );
  });

  it("falls back to the menu on an unknown --template interactively", async () => {
    const p = scripted({ select: [MORE_EXAMPLES, "classify-message"] });
    const out = await resolveScaffoldOptions({ dir: "d", template: "nope", interactive: true, provider: "none" }, p);
    expect(out).toMatchObject({ kind: "scaffold", template: "classify-message" });
    expect(p.notes.join("\n")).toContain('Unknown template "nope"');
  });

  it("non-empty target: declining the remove-confirm cancels", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "keep.txt"), "x");
    const out = await resolveScaffoldOptions({ dir, template: "typescript-interop", interactive: true, provider: "none" }, scripted({ confirm: [false] }));
    expect(out).toEqual({ kind: "cancelled" });
  });

  it("non-empty target: confirming sets force", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "old.txt"), "x");
    const out = await resolveScaffoldOptions(
      { dir, template: "typescript-interop", interactive: true, provider: "none" },
      scripted({ confirm: [true] }),
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
    const p = scripted({ select: ["extract-resume"] });
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
    expect(out).toEqual({ kind: "add", dir: ".", provider: "none", ide: "vscode", agents: ["claude", "universal"] });
  });

  it("--add keeps an explicit dir", async () => {
    const out = await resolveScaffoldOptions(
      { add: true, dir: "proj", interactive: true, provider: "none" },
      scripted({}),
    );
    expect(out).toEqual({ kind: "add", dir: "proj", provider: "none", ide: "vscode", agents: ["claude", "universal"] });
  });

  it("--add with --template is contradictory", async () => {
    await expect(
      resolveScaffoldOptions({ add: true, template: "typescript-interop", interactive: false }, scripted({})),
    ).rejects.toThrow(/--add and --template/);
  });

  it("bare interactive run detects the cwd package.json and offers add", async () => {
    const cwd = await tmp();
    await writeFile(join(cwd, "package.json"), '{"name":"my-api"}');
    const p = scripted({ select: ["add"] });
    const out = await resolveScaffoldOptions({ interactive: true, provider: "none", cwd }, p);
    expect(out).toEqual({ kind: "add", dir: cwd, provider: "none", ide: "vscode", agents: ["claude", "universal"] });
  });

  it("detection: choosing new project continues into the normal flow", async () => {
    const cwd = await tmp();
    await writeFile(join(cwd, "package.json"), '{"name":"my-api"}');
    const p = scripted({ select: ["new", "empty"], text: ["fresh-app"] });
    const out = await resolveScaffoldOptions({ interactive: true, provider: "none", cwd }, p);
    expect(out).toEqual({
      kind: "scaffold",
      dir: "fresh-app",
      template: "empty",
      force: false,
      provider: "none",
      ide: "vscode",
      agents: ["claude", "universal"],
    });
  });

  it("a dir argument bypasses detection", async () => {
    const cwd = await tmp();
    await writeFile(join(cwd, "package.json"), '{"name":"my-api"}');
    const p = scripted({ select: ["typescript-interop"] });
    const out = await resolveScaffoldOptions({ dir: "sub", interactive: true, provider: "none", cwd }, p);
    expect(out).toMatchObject({ kind: "scaffold", dir: "sub", template: "typescript-interop" });
  });

  it("non-interactive bare run never detects (stays deterministic)", async () => {
    const cwd = await tmp();
    await writeFile(join(cwd, "package.json"), '{"name":"my-api"}');
    const out = await resolveScaffoldOptions({ interactive: false, cwd }, scripted({}));
    expect(out).toEqual({
      kind: "scaffold",
      dir: "nola-app",
      template: "feature-extraction",
      force: false,
      provider: "none",
      ide: "vscode",
      agents: ["claude", "universal"],
    });
  });

  it("non-empty target WITH package.json offers add", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "package.json"), '{"name":"existing"}');
    const p = scripted({ select: ["add"] });
    const out = await resolveScaffoldOptions({ dir, template: "typescript-interop", interactive: true, provider: "none" }, p);
    expect(out).toEqual({ kind: "add", dir, provider: "none", ide: "vscode", agents: ["claude", "universal"] });
  });

  it("non-empty target WITH package.json can still scaffold fresh", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "package.json"), '{"name":"existing"}');
    const p = scripted({ select: ["fresh"] });
    const out = await resolveScaffoldOptions({ dir, template: "typescript-interop", interactive: true, provider: "none" }, p);
    expect(out).toEqual({ kind: "scaffold", dir, template: "typescript-interop", force: true, provider: "none", ide: "vscode", agents: ["claude", "universal"] });
  });

  it("non-empty target WITHOUT package.json keeps the remove-confirm", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "keep.txt"), "x");
    const p = scripted({ confirm: [true] });
    const out = await resolveScaffoldOptions({ dir, template: "typescript-interop", interactive: true, provider: "none" }, p);
    expect(out).toEqual({ kind: "scaffold", dir, template: "typescript-interop", force: true, provider: "none", ide: "vscode", agents: ["claude", "universal"] });
  });
});

describe("resolveScaffoldOptions — the setup step is retired (editor + agents are defaults)", () => {
  it("asks nothing after the template: VS Code and both skill copies are the answer", async () => {
    const p = scripted({ select: ["typescript-interop"] });
    const asked = recording(p);
    const out = await resolveScaffoldOptions({ dir: "d", interactive: true, provider: "none" }, p);
    expect(out).toEqual({
      kind: "scaffold",
      dir: "d",
      template: "typescript-interop",
      force: false,
      provider: "none",
      ide: "vscode",
      agents: ["claude", "universal"],
    });
    expect(asked).toEqual([TEMPLATE_QUESTION]);
    expect(asked.join("\n")).not.toContain(SETUP_QUESTION);
  });

  it("the add path gets the same defaults without a question", async () => {
    const cwd = await tmp();
    await writeFile(join(cwd, "package.json"), '{"name":"my-api"}');
    const p = scripted({ select: ["add"] });
    const asked = recording(p);
    const out = await resolveScaffoldOptions({ interactive: true, provider: "none", cwd }, p);
    expect(out).toEqual({ kind: "add", dir: cwd, provider: "none", ide: "vscode", agents: ["claude", "universal"] });
    expect(asked).toHaveLength(1);
  });

  it("--ide none opts out of the editor; the agents default stays", async () => {
    const out = await resolveScaffoldOptions(
      { dir: "d", template: "typescript-interop", ide: "none", interactive: true, provider: "none" },
      scripted({}),
    );
    expect(out).toEqual({
      kind: "scaffold",
      dir: "d",
      template: "typescript-interop",
      force: false,
      provider: "none",
      ide: "none",
      agents: ["claude", "universal"],
    });
  });

  it("--ide vscode is the default spelled out", async () => {
    const out = await resolveScaffoldOptions(
      { dir: "d", template: "typescript-interop", ide: "vscode", interactive: true, provider: "none" },
      scripted({}),
    );
    expect(out).toMatchObject({ kind: "scaffold", ide: "vscode", agents: ["claude", "universal"] });
  });

  it("rejects an invalid --ide listing valid values", async () => {
    await expect(
      resolveScaffoldOptions({ dir: "d", ide: "emacs", interactive: false }, scripted({})),
    ).rejects.toThrow(/invalid --ide "emacs".*vscode.*none/);
  });

  it("non-interactive runs get the same defaults as interactive ones", async () => {
    const out = await resolveScaffoldOptions({ interactive: false }, scripted({}));
    expect(out).toMatchObject({ kind: "scaffold", ide: "vscode", agents: ["claude", "universal"] });
  });
});

describe("runFlow — editor step", () => {
  it("writes .vscode when the scaffold outcome carries ide: vscode", async () => {
    const dir = join(await tmp(), "app");
    const code = await runFlow({ dir, template: "empty", ide: "vscode" }, { interactive: false, prompter: scripted({}) });
    expect(code).toBe(0);
    expect(existsSync(join(dir, ".vscode", "launch.json"))).toBe(true);
    expect(existsSync(join(dir, ".vscode", "extensions.json"))).toBe(true);
    // the entry file greets the user with the VS Code next steps the launch config enables
    const main = await readFile(join(dir, "src", "main.ts"), "utf8");
    expect(main).toContain("F5");
    expect(main).not.toContain("__NEXT_STEPS__");
  });

  it("feature-extraction's launch config runs src/main.tsi, and that file carries the next steps", async () => {
    const dir = join(await tmp(), "app");
    const code = await runFlow({ dir, ide: "vscode" }, { interactive: false, prompter: scripted({}) });
    expect(code).toBe(0);
    const launch = JSON.parse(await readFile(join(dir, ".vscode", "launch.json"), "utf8"));
    // biome-ignore lint/suspicious/noTemplateCurlyInString: VS Code variable syntax
    expect(launch.configurations[0].program).toBe("${workspaceFolder}/src/main.tsi");
    expect(existsSync(join(dir, "src", "main.ts"))).toBe(false);
    const main = await readFile(join(dir, "src", "main.tsi"), "utf8");
    expect(main).toContain("F5");
    expect(main).not.toContain("__NEXT_STEPS__");
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

  it("without --ide the .vscode files are written — the editor setup is the default, non-interactively too", async () => {
    const dir = join(await tmp(), "app");
    await runFlow({ dir, template: "empty" }, { interactive: false, prompter: scripted({}) });
    expect(existsSync(join(dir, ".vscode", "launch.json"))).toBe(true);
    expect(existsSync(join(dir, ".vscode", "extensions.json"))).toBe(true);
    const main = await readFile(join(dir, "src", "main.ts"), "utf8");
    expect(main).toContain("F5");
  });

  it("--ide none writes no .vscode, and the entry file's next steps are editor-neutral", async () => {
    const dir = join(await tmp(), "app");
    await runFlow({ dir, template: "empty", ide: "none" }, { interactive: false, prompter: scripted({}) });
    expect(existsSync(join(dir, ".vscode"))).toBe(false);
    const main = await readFile(join(dir, "src", "main.ts"), "utf8");
    expect(main).not.toContain("F5");
    expect(main).toContain("npm start");
  });
});

describe("runFlow — install + open VS Code step", () => {
  /** Records what the flow would have executed instead of spawning anything. */
  function recordingLauncher(
    opts: { installExit?: number; code?: "opened" | "not-found" | "absent"; output?: string[] } = {},
  ) {
    const calls: string[] = [];
    return {
      calls,
      launcher: {
        // "absent" = `code` is not on PATH when the flow checks, BEFORE the question
        hasVscode: () => opts.code !== "absent",
        install: async (pm: string, dir: string, onOutput: (chunk: string) => void) => {
          calls.push(`install:${pm}:${basename(dir)}`);
          for (const chunk of opts.output ?? ["\nadded 12 packages in 3s\n"]) onOutput(chunk);
          return opts.installExit ?? 0;
        },
        openVscode: async (dir: string, entry?: string) => {
          calls.push(`code:${basename(dir)}${entry ? `:${entry}` : ""}`);
          return opts.code ?? ("opened" as const);
        },
      },
    };
  }

  it("asks after the scaffold when VS Code was chosen; yes installs then opens, in the project dir", async () => {
    const dir = join(await tmp(), "app");
    const p = scripted({ select: ["empty"], confirm: [true] });
    const asked = recording(p);
    const { calls, launcher } = recordingLauncher();
    const code = await runFlow({ dir, provider: "none" }, { interactive: true, prompter: p, launcher, packageManager: "pnpm" });
    expect(code).toBe(0);
    expect(asked.at(-1)).toBe(`${INSTALL_OPEN_QUESTION}|true`);
    expect(calls).toEqual(["install:pnpm:app", "code:app:src/main.ts"]);
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

  it("opens VS Code on src/main.tsi for function-calling too (its entry is the .tsi)", async () => {
    const dir = join(await tmp(), "app");
    const p = scripted({ select: ["function-calling"], confirm: [true] });
    const { calls, launcher } = recordingLauncher();
    const code = await runFlow({ dir, provider: "none" }, { interactive: true, prompter: p, launcher, packageManager: "npm" });
    expect(code).toBe(0);
    expect(calls).toEqual(["install:npm:app", "code:app:src/main.tsi"]);
    const launch = JSON.parse(await readFile(join(dir, ".vscode", "launch.json"), "utf8"));
    // biome-ignore lint/suspicious/noTemplateCurlyInString: VS Code variable syntax
    expect(launch.configurations[0].program).toBe("${workspaceFolder}/src/main.tsi");
  });

  it("opens VS Code on src/main.tsi for feature-extraction", async () => {
    const dir = join(await tmp(), "app");
    const p = scripted({ select: ["feature-extraction"], confirm: [true] });
    const { calls, launcher } = recordingLauncher();
    const code = await runFlow({ dir, provider: "none" }, { interactive: true, prompter: p, launcher, packageManager: "npm" });
    expect(code).toBe(0);
    expect(calls).toEqual(["install:npm:app", "code:app:src/main.tsi"]);
  });

  it("with NOLA_LINK_CHECKOUT set, a successful install is relinked to that checkout's packages and the outro says so", async () => {
    const dir = join(await tmp(), "app");
    const p = scripted({ select: ["empty"], confirm: [true] });
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
    // The linked runtime lives in packages/*/dist, outside node_modules, so the
    // launch config must blackbox it or F10 over the first ask runs to the end.
    const launch = JSON.parse(await readFile(join(dir, ".vscode", "launch.json"), "utf8"));
    expect(launch.configurations[0].skipFiles).toContain("**/packages/*/dist/**");
    expect(notes).toContain("**/packages/*/dist/**");
  });

  it("the env variable is read when the option is absent", async () => {
    const dir = join(await tmp(), "app");
    const p = scripted({ select: ["empty"], confirm: [true] });
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
    const p = scripted({ select: ["empty"], confirm: [true] });
    const { launcher } = recordingLauncher();
    await runFlow({ dir, provider: "none" }, { interactive: true, prompter: p, launcher, linkCheckout: null });
    expect(existsSync(join(dir, "node_modules", "nola-lang"))).toBe(false);
    expect(p.notes.join("\n")).not.toContain("NOLA_LINK_CHECKOUT");
  });

  it("no leaves everything to the user (nothing runs, install stays in Next steps)", async () => {
    const dir = join(await tmp(), "app");
    const p = scripted({ select: ["empty"], confirm: [false] });
    const { calls, launcher } = recordingLauncher();
    await runFlow({ dir, provider: "none" }, { interactive: true, prompter: p, launcher });
    expect(calls).toEqual([]);
    expect(p.notes.at(-1)).toContain("npm install");
  });

  it("Ctrl+C at that prompt is a no, not a flow cancel — the project is already written", async () => {
    const dir = join(await tmp(), "app");
    const p = scripted({ select: ["empty"], confirm: [null] });
    const { calls, launcher } = recordingLauncher();
    const code = await runFlow({ dir, provider: "none" }, { interactive: true, prompter: p, launcher });
    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(existsSync(join(dir, "nola.config.ts"))).toBe(true);
    expect(p.notes.join("\n")).not.toContain("Cancelled");
  });

  it("is never asked under --ide none", async () => {
    const dir = join(await tmp(), "app");
    // no confirm answers queued: being asked would throw through the scripted prompter
    const p = scripted({ select: ["empty"] });
    const { calls, launcher } = recordingLauncher();
    await runFlow({ dir, provider: "none", ide: "none" }, { interactive: true, prompter: p, launcher });
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
    const p = scripted({});
    const { calls, launcher } = recordingLauncher();
    await runFlow({ dir, add: true, provider: "none" }, { interactive: true, prompter: p, launcher });
    expect(calls).toEqual([]);
  });

  it("a failing install is reported with the output tail, and VS Code still opens", async () => {
    const dir = join(await tmp(), "app");
    const p = scripted({ select: ["empty"], confirm: [true] });
    const { calls, launcher } = recordingLauncher({
      installExit: 1,
      output: ["npm ERR! code E404\n", "npm ERR! 404 Not Found - GET https://registry.npmjs.org/nope\n"],
    });
    await runFlow({ dir, provider: "none" }, { interactive: true, prompter: p, launcher });
    expect(calls).toEqual(["install:npm:app", "code:app:src/main.ts"]);
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

  it("without VS Code on PATH the question is just the install, and nothing is opened", async () => {
    const dir = join(await tmp(), "app");
    const p = scripted({ select: ["empty"], confirm: [true] });
    const asked = recording(p);
    const { calls, launcher } = recordingLauncher({ code: "absent" });
    const code = await runFlow({ dir, provider: "none" }, { interactive: true, prompter: p, launcher });
    expect(code).toBe(0);
    expect(asked.at(-1)).toBe(`${INSTALL_QUESTION}|true`);
    expect(INSTALL_QUESTION).not.toMatch(/VS Code/);
    expect(calls).toEqual(["install:npm:app"]);
    const notes = p.notes.join("\n");
    expect(notes).toContain("progress done: Installed dependencies (npm install)");
    // nothing to explain: the user was never promised an editor
    expect(notes).not.toContain("`code` command");
    // the .vscode files are still there for whenever VS Code arrives
    expect(existsSync(join(dir, ".vscode", "launch.json"))).toBe(true);
  });

  it("a `code` command that vanishes between the check and the open is explained, not thrown", async () => {
    const dir = join(await tmp(), "app");
    const p = scripted({ select: ["empty"], confirm: [true] });
    const { launcher } = recordingLauncher({ code: "not-found" });
    const code = await runFlow({ dir, provider: "none" }, { interactive: true, prompter: p, launcher });
    expect(code).toBe(0);
    expect(p.notes.join("\n")).toContain("`code` command");
  });
});

describe("resolveScaffoldOptions — agents flags", () => {
  it("--agents is carried verbatim (comma list), the editor default untouched", async () => {
    const out = await resolveScaffoldOptions(
      { dir: "d", template: "typescript-interop", agents: "claude,agents-md", interactive: true, provider: "none" },
      scripted({}),
    );
    expect(out).toMatchObject({ kind: "scaffold", ide: "vscode", agents: ["claude", "agents-md"] });
  });

  it("--agents none opts out of the skill; --agents none plus --ide none opts out of both", async () => {
    const some = await resolveScaffoldOptions(
      { dir: "d", template: "typescript-interop", agents: "none", interactive: true, provider: "none" },
      scripted({}),
    );
    expect(some).toMatchObject({ kind: "scaffold", ide: "vscode", agents: [] });
    const none = await resolveScaffoldOptions(
      { dir: "d", template: "typescript-interop", ide: "none", agents: "none", interactive: true, provider: "none" },
      scripted({}),
    );
    expect(none).toMatchObject({ kind: "scaffold", ide: "none", agents: [] });
  });

  it("rejects an invalid --agents id listing valid values", async () => {
    await expect(
      resolveScaffoldOptions({ dir: "d", agents: "emacs", interactive: false }, scripted({})),
    ).rejects.toThrow(/invalid --agents "emacs".*claude, universal, agents-md/);
  });
});

describe("runFlow — agents step", () => {
  it("writes the skill when the scaffold outcome carries agents", async () => {
    const dir = join(await tmp(), "app");
    const code = await runFlow(
      { dir, template: "empty", agents: "claude,universal,agents-md" },
      { interactive: false, prompter: scripted({}) },
    );
    expect(code).toBe(0);
    expect(existsSync(join(dir, ".agents", "skills", "nola", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "skills", "nola", "SKILL.md"))).toBe(true);
    // one copy of the content: Claude Code reads it through a link
    expect((await lstat(join(dir, ".claude", "skills", "nola"))).isSymbolicLink()).toBe(true);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(dir, ".cursor"))).toBe(false);
  });

  it("writes the skill on add mode and reports an existing AGENTS.md as skipped", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "package.json"), '{"name":"existing-api"}\n');
    await writeFile(join(dir, "AGENTS.md"), "# Existing\n");
    const p = scripted({});
    const code = await runFlow({ dir, add: true, agents: "agents-md,universal" }, { interactive: false, prompter: p });
    expect(code).toBe(0);
    expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toBe("# Existing\n");
    expect(existsSync(join(dir, ".agents", "skills", "nola", "SKILL.md"))).toBe(true);
    expect(p.notes.join("\n")).toContain("AGENTS.md already exists");
  });

  it("without --agents both skill copies are written and AGENTS.md is not — the default, non-interactively too", async () => {
    const dir = join(await tmp(), "app");
    await runFlow({ dir, template: "empty" }, { interactive: false, prompter: scripted({}) });
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(dir, ".agents", "skills", "nola", "SKILL.md"))).toBe(true);
    expect((await lstat(join(dir, ".claude", "skills", "nola"))).isSymbolicLink()).toBe(true);
    expect(existsSync(join(dir, ".claude", "skills", "nola", "references", "syntax.md"))).toBe(true);
  });

  it("--agents none writes no skill", async () => {
    const dir = join(await tmp(), "app");
    await runFlow({ dir, template: "empty", agents: "none" }, { interactive: false, prompter: scripted({}) });
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(dir, ".agents"))).toBe(false);
    expect(existsSync(join(dir, ".claude"))).toBe(false);
  });
});

describe("runFlow — next steps follow the invoking package manager", () => {
  it("defaults to npm", async () => {
    const dir = join(await tmp(), "app");
    const p = scripted({});
    await runFlow({ dir, template: "typescript-interop" }, { interactive: false, prompter: p });
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
    await runFlow({ dir, template: "typescript-interop" }, { interactive: false, prompter: p });
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

describe("template menu", () => {
  it("the first menu is the templates by feature, feature-extraction first, triage-ticket (typesafe.ai) before empty, then one row that opens the examples", () => {
    expect(templateMenu().map((o) => o.value)).toEqual([
      "feature-extraction",
      "function-calling",
      "typescript-interop",
      "triage-ticket",
      "empty",
      MORE_EXAMPLES,
    ]);
    const more = templateMenu().at(-1) as PrompterOption;
    expect(more.label).toBe("More examples…");
    expect(more.hint).toContain("file-ticket");
    expect(more.hint).not.toContain("triage-ticket");
    for (const o of templateMenu().slice(0, 5)) {
      expect(o.label).toBe(o.value === "triage-ticket" ? "triage-ticket (typesafe.ai)" : o.value);
    }
  });

  it("the examples menu lists the curated examples the first menu does not carry, then a Back row", () => {
    const rows = exampleMenu();
    expect(rows.map((o) => o.value)).toEqual([
      "file-ticket",
      "extract-resume",
      "extract-invoice",
      "classify-message",
      "chain-of-thought",
      "research-notes",
      BACK,
    ]);
    expect(rows.find((o) => o.value === "file-ticket")?.label).toBe("file-ticket");
    expect((rows.at(-1) as PrompterOption).label).toBe("← Back");
  });

  it("More examples… opens the second menu and the chosen example is the template", async () => {
    const p = scripted({ select: [MORE_EXAMPLES, "extract-resume"] });
    const asked = recording(p);
    const out = await resolveScaffoldOptions({ dir: "d", interactive: true, provider: "none" }, p);
    expect(asked).toEqual([TEMPLATE_QUESTION, EXAMPLE_QUESTION]);
    expect(out).toMatchObject({ kind: "scaffold", template: "extract-resume" });
  });

  it("Back returns to the first menu", async () => {
    const p = scripted({ select: [MORE_EXAMPLES, BACK, "typescript-interop"] });
    const asked = recording(p);
    const out = await resolveScaffoldOptions({ dir: "d", interactive: true, provider: "none" }, p);
    expect(asked).toEqual([TEMPLATE_QUESTION, EXAMPLE_QUESTION, TEMPLATE_QUESTION]);
    expect(out).toMatchObject({ kind: "scaffold", template: "typescript-interop" });
  });

  it("Ctrl+C on either menu cancels", async () => {
    expect(await resolveScaffoldOptions({ dir: "d", interactive: true, provider: "none" }, scripted({ select: [null] }))).toEqual({
      kind: "cancelled",
    });
    expect(
      await resolveScaffoldOptions({ dir: "d", interactive: true, provider: "none" }, scripted({ select: [MORE_EXAMPLES, null] })),
    ).toEqual({ kind: "cancelled" });
  });

  it("feature-extraction is the non-interactive default", async () => {
    const out = await resolveScaffoldOptions({ dir: "d", interactive: false }, scripted({}));
    expect(out).toMatchObject({ kind: "scaffold", template: "feature-extraction" });
  });
});

describe("wizard order", () => {
  /** Every prompt in the order it was shown, with the preselection where one exists. */

  it("asks name, template, the inference provider — and nothing after it: the editor and both skill copies are defaults", async () => {
    const p = scripted({ text: ["app"], select: ["typescript-interop", "nola"] });
    const asked = recording(p);
    const out = await resolveScaffoldOptions({ interactive: true, cwd: await tmp() }, p);
    expect(asked).toEqual([`${NAME_QUESTION}|nola-app`, "Select a template:", PROVIDER_QUESTION]);
    expect(out).toEqual({
      kind: "scaffold",
      dir: "app",
      template: "typescript-interop",
      force: false,
      provider: "nola",
      ide: "vscode",
      agents: ["claude", "universal"],
    });
  });

  it("the retired setup gate is never shown, whatever the flags leave unanswered", async () => {
    const p = scripted({ select: ["typescript-interop"] });
    const asked = recording(p);
    const out = await resolveScaffoldOptions({ dir: "d", agents: "agents-md", interactive: true, provider: "none" }, p);
    expect(asked).toEqual(["Select a template:"]);
    expect(out).toMatchObject({ kind: "scaffold", ide: "vscode", agents: ["agents-md"] });
  });

  it("the name prompt says Enter keeps the default", () => {
    expect(NAME_QUESTION).toMatch(/Enter/);
    expect(NAME_QUESTION).toContain("nola-app");
  });

  it("the add path asks the provider and nothing after it", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "package.json"), '{"name":"x"}');
    const p = scripted({ select: ["none"] });
    const asked = recording(p);
    const out = await resolveScaffoldOptions({ add: true, dir, interactive: true }, p);
    expect(asked).toEqual([PROVIDER_QUESTION]);
    expect(out).toEqual({ kind: "add", dir, provider: "none", ide: "vscode", agents: ["claude", "universal"] });
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

  it("lists nola (first), the four vendors and skip, in that order, and lands the choice on the outcome", async () => {
    const p = scripted({ text: ["app"], select: ["typescript-interop", "anthropic"], confirm: [false] });
    const shown = recordOptions(p);
    const out = await resolveScaffoldOptions({ interactive: true, cwd: await tmp() }, p);
    expect(out).toMatchObject({ kind: "scaffold", template: "typescript-interop", provider: "anthropic" });
    expect(shown[PROVIDER_QUESTION]?.map((o) => `${o.value}|${o.label}`)).toEqual([
      "nola|nola: dev",
      "openai|OpenAI",
      "anthropic|Anthropic",
      "google|Gemini",
      "typesafe|typesafe.ai",
      "none|Skip for now",
    ]);
    expect(shown[PROVIDER_QUESTION]?.[0]?.hint).toBe("25 free hosted runs, no API key required, suited for dev experiments");
  });

  it("the typesafe row's hint brackets the caveat for the selected template, generic in add mode, absent when the template pins typesafe.ai", () => {
    const hintFor = (template?: string) => providerOptions({ kind: "trial" }, template).find((o) => o.value === "typesafe")?.hint;
    expect(hintFor("typescript-interop")).toBe(
      "typesafe(), reads TYPESAFE_API_KEY (does not support every construct in typescript-interop: literal unions and booleans only)",
    );
    expect(hintFor("extract-resume")).toContain("(does not support every construct in extract-resume:");
    expect(hintFor(undefined)).toBe("typesafe(), reads TYPESAFE_API_KEY (literal unions and booleans only)");
    expect(hintFor("triage-ticket")).toBe("typesafe(), reads TYPESAFE_API_KEY");
  });

  it("the typesafe row is shown for a template it does not fully support and lands on the outcome", async () => {
    const p = scripted({ text: ["app"], select: ["extract-resume", "typesafe"], confirm: [false] });
    const shown = recordOptions(p);
    const out = await resolveScaffoldOptions({ interactive: true, cwd: await tmp() }, p);
    expect(out).toMatchObject({ kind: "scaffold", template: "extract-resume", provider: "typesafe" });
    expect(shown[PROVIDER_QUESTION]?.find((o) => o.value === "typesafe")?.hint).toContain("every construct in extract-resume");
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
      /invalid --provider "mistral".*nola, openai, anthropic, google, typesafe, none/,
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
    expect(await runFlow({ dir, template: "typescript-interop", provider: "anthropic" }, { interactive: false, prompter: p, fetch: fn, home: await tmp() })).toBe(0);
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
  it('sends an EMPTY trial body, records the account in ~/.nola/config.json (and nothing else), scaffolds without the ledger, writes .env and the model: "nola" config', async () => {
    const dir = join(await tmp(), "app");
    const home = await tmp();
    const { fn, calls } = trialFetch();
    const p = scripted({});
    const code = await runFlow(
      { dir, template: "typescript-interop", provider: "nola" },
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
    expect(await readFile(join(dir, "nola.config.ts"), "utf8")).toContain('model: "nola"');
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
        { dir, template: "typescript-interop", provider: "nola" },
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
        { dir, template: "typescript-interop", provider: "nola" },
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
  it("interactive on a used machine: Enter on the Nola row runs the PKCE sign-in RIGHT THERE (browser at the select, before anything else) with the recorded trial account as the hint, the session is stored, the key comes from the console", async () => {
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
    expect(await runFlow({ dir, template: "empty", ide: "none" }, { interactive: true, prompter: p, fetch: fn, home, apiUrl: "https://api.nola.sh", open })).toBe(0);
    expect(events).toEqual([`select:${PROVIDER_QUESTION}`, "browser"]);
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
    expect(await runFlow({ dir, template: "typescript-interop" }, { interactive: true, prompter: p, fetch: fn, home, apiUrl: "https://api.nola.sh", open: () => true })).toBe(0);
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
        { dir, template: "typescript-interop", provider: "nola" },
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
        { dir: dir2, template: "typescript-interop", provider: "nola" },
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
    const code = await runFlow({ dir, template: "typescript-interop", provider: "nola" }, { interactive: false, prompter: p, fetch: fn, home });
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
    expect(await readFile(join(dir, "nola.config.ts"), "utf8")).toContain('model: "nola"');
    expect(p.notes.at(-1)).toMatch(/Added Nola: nola\.config\.ts, package\.json, .*\.env/);

    // second project with its own config: the key is written, the config is left alone and named
    const dir2 = await tmp();
    await writeFile(join(dir2, "package.json"), '{"name":"has-config"}\n');
    await writeFile(join(dir2, "nola.config.ts"), "export default {};\n");
    const p2 = scripted({});
    expect(await runFlow({ dir: dir2, add: true, provider: "nola" }, { interactive: false, prompter: p2, fetch: fn, home: await tmp() })).toBe(0);
    expect(await readFile(join(dir2, "nola.config.ts"), "utf8")).toBe("export default {};\n");
    expect(p2.notes.some((n) => n.includes('model: "nola"'))).toBe(true);
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

describe("runFlow: old-Node warning", () => {
  it("warns at the top of a scaffold when the running Node cannot load .ts natively", async () => {
    const dir = join(await tmp(), "app");
    const p = scripted({});
    const code = await runFlow({ dir, template: "empty" }, { interactive: false, prompter: p, nodeVersion: "22.6.0" });
    expect(code).toBe(0);
    const warning = p.notes.find((n) => n.includes("ERR_UNKNOWN_FILE_EXTENSION"));
    expect(warning).toContain("Node 22.6.0");
    expect(warning).toContain("--experimental-strip-types");
    expect(p.notes.indexOf(warning as string)).toBe(0);
  });

  it("warns on the add path too (nola init in an existing project)", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "existing", version: "0.0.0", type: "module" }));
    const p = scripted({});
    const code = await runFlow({ add: true, dir }, { interactive: false, prompter: p, nodeVersion: "22.12.0" });
    expect(code).toBe(0);
    expect(p.notes.some((n) => n.includes("Node 22.12.0"))).toBe(true);
  });

  it("stays silent on a supported Node", async () => {
    const dir = join(await tmp(), "app");
    const p = scripted({});
    await runFlow({ dir, template: "empty" }, { interactive: false, prompter: p, nodeVersion: "22.18.0" });
    expect(p.notes.some((n) => n.includes("ERR_UNKNOWN_FILE_EXTENSION"))).toBe(false);
  });
});

describe("a template that pins its vendor (triage-ticket)", () => {
  it("skips the provider question and keeps the template's own config (provider none)", async () => {
    const p = scripted({ select: ["triage-ticket"] });
    const asked = recording(p);
    const out = await resolveScaffoldOptions({ dir: "d", interactive: true }, p);
    expect(asked).toEqual([TEMPLATE_QUESTION]);
    expect(out).toEqual({
      kind: "scaffold",
      dir: "d",
      template: "triage-ticket",
      force: false,
      provider: "none",
      ide: "vscode",
      agents: ["claude", "universal"],
    });
  });

  it("its first-menu row names the vendor: `triage-ticket (typesafe.ai)`, right before empty; the other rows are unchanged", async () => {
    const p = scripted({ select: ["triage-ticket"], confirm: [false] });
    const shown: Record<string, PrompterOption[]> = {};
    const select = p.select;
    p.select = (m, o) => {
      shown[m] = o;
      return select(m, o);
    };
    await resolveScaffoldOptions({ dir: "d", interactive: true }, p);
    const rows = shown[TEMPLATE_QUESTION]?.map((o) => o.label) ?? [];
    expect(rows.indexOf("triage-ticket (typesafe.ai)")).toBe(rows.indexOf("empty") - 1);
    expect(rows[0]).toBe("feature-extraction");
  });

  it("an explicit --provider flag still wins over the pin", async () => {
    const out = await resolveScaffoldOptions(
      { dir: "d", interactive: false, template: "triage-ticket", provider: "anthropic" },
      scripted({}),
    );
    expect(out).toMatchObject({ kind: "scaffold", template: "triage-ticket", provider: "anthropic" });
  });

  it("runFlow copies the example's typesafe config verbatim and the outro names TYPESAFE_API_KEY", async () => {
    const dir = join(await tmp(), "app");
    const p = scripted({});
    expect(await runFlow({ dir, template: "triage-ticket" }, { interactive: false, prompter: p, home: await tmp() })).toBe(0);
    expect(await readFile(join(dir, "nola.config.ts"), "utf8")).toContain("model: typesafe()");
    expect(existsSync(join(dir, "nola.replay.jsonl"))).toBe(false);
    // one file is the program: the .tsi entry, no plain-TS consumer, launch.json runs it
    expect(existsSync(join(dir, "src", "main.tsi"))).toBe(true);
    expect(existsSync(join(dir, "src", "main.ts"))).toBe(false);
    expect(await readFile(join(dir, ".vscode", "launch.json"), "utf8")).toContain(`\${workspaceFolder}/src/main.tsi`);
    expect(await readFile(join(dir, ".env.example"), "utf8")).toContain("TYPESAFE_API_KEY=");
    expect(p.notes.at(-1)).toContain("npm start              # set TYPESAFE_API_KEY in .env first");
  });
});
