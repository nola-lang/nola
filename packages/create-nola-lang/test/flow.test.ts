import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Prompter, resolveScaffoldOptions, runFlow } from "../src/flow.js";

const tmp = () => mkdtemp(join(tmpdir(), "nola-flow-"));

/** Scripted prompter: consumes queued answers; records notes. */
function scripted(script: {
  text?: (string | null)[];
  select?: (string | null)[];
  confirm?: (boolean | null)[];
  multiselect?: (string[] | null)[];
}): Prompter & { notes: string[] } {
  const text = [...(script.text ?? [])];
  const select = [...(script.select ?? [])];
  const confirm = [...(script.confirm ?? [])];
  const multiselect = [...(script.multiselect ?? [])];
  const notes: string[] = [];
  return {
    notes,
    text: async () => (text.length > 0 ? (text.shift() as string | null) : null),
    select: async () => (select.length > 0 ? (select.shift() as string | null) : null),
    confirm: async () => (confirm.length > 0 ? (confirm.shift() as boolean | null) : null),
    multiselect: async () => (multiselect.length > 0 ? (multiselect.shift() as string[] | null) : null),
    note: (m) => {
      notes.push(m);
    },
  };
}

describe("resolveScaffoldOptions", () => {
  it("prompts name then template when nothing is given", async () => {
    const p = scripted({ text: ["my-proj"], select: ["empty", "none"], multiselect: [[]] });
    const out = await resolveScaffoldOptions({ interactive: true, cwd: await tmp() }, p);
    expect(out).toEqual({
      kind: "scaffold",
      dir: "my-proj",
      template: "empty",
      force: false,
      ide: "none",
      agents: [],
    });
  });

  it("skips the name prompt when dir is given, the template prompt when --template is given", async () => {
    const p = scripted({ select: ["none"], multiselect: [[]] });
    const out = await resolveScaffoldOptions({ dir: "given-dir", template: "starter", interactive: true }, p);
    expect(out).toEqual({
      kind: "scaffold",
      dir: "given-dir",
      template: "starter",
      force: false,
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
      ide: "none",
      agents: [],
    });
  });

  it("empty name answer falls back to the default", async () => {
    const p = scripted({ text: ["   "], select: ["starter", "none"], multiselect: [[]] });
    const out = await resolveScaffoldOptions({ interactive: true, cwd: await tmp() }, p);
    expect(out).toMatchObject({ kind: "scaffold", dir: "nola-app" });
  });

  it("cancelling the name prompt cancels the flow", async () => {
    const out = await resolveScaffoldOptions({ interactive: true, cwd: await tmp() }, scripted({ text: [null] }));
    expect(out).toEqual({ kind: "cancelled" });
  });

  it("rejects an unknown --template non-interactively, listing valid names", async () => {
    await expect(resolveScaffoldOptions({ dir: "d", template: "nope", interactive: false }, scripted({}))).rejects.toThrow(
      /unknown template "nope".*starter/,
    );
  });

  it("falls back to the menu on an unknown --template interactively", async () => {
    const p = scripted({ select: ["classify-message", "none"], multiselect: [[]] });
    const out = await resolveScaffoldOptions({ dir: "d", template: "nope", interactive: true }, p);
    expect(out).toMatchObject({ kind: "scaffold", template: "classify-message" });
    expect(p.notes.join("\n")).toContain('Unknown template "nope"');
  });

  it("non-empty target: declining the remove-confirm cancels", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "keep.txt"), "x");
    const out = await resolveScaffoldOptions({ dir, template: "starter", interactive: true }, scripted({ confirm: [false] }));
    expect(out).toEqual({ kind: "cancelled" });
  });

  it("non-empty target: confirming sets force", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "old.txt"), "x");
    const out = await resolveScaffoldOptions(
      { dir, template: "starter", interactive: true },
      scripted({ confirm: [true], select: ["none"], multiselect: [[]] }),
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
    const p = scripted({ select: ["extract-resume", "none"], multiselect: [[]] });
    const code = await runFlow({ dir }, { interactive: true, prompter: p });
    expect(code).toBe(0);
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(pkg.name).toBe("resume-app");
  });

  it("returns 0 and writes nothing when cancelled", async () => {
    const dir = join(await tmp(), "never");
    const code = await runFlow({}, { interactive: true, prompter: scripted({ text: [null] }), cwd: await tmp() });
    expect(code).toBe(0);
    expect(existsSync(dir)).toBe(false);
  });
});

describe("resolveScaffoldOptions — add mode", () => {
  it("--add resolves straight to the add outcome (default dir '.')", async () => {
    const out = await resolveScaffoldOptions({ add: true, interactive: false }, scripted({}));
    expect(out).toEqual({ kind: "add", dir: ".", ide: "none", agents: [] });
  });

  it("--add keeps an explicit dir", async () => {
    const out = await resolveScaffoldOptions(
      { add: true, dir: "proj", interactive: true },
      scripted({ select: ["none"], multiselect: [[]] }),
    );
    expect(out).toEqual({ kind: "add", dir: "proj", ide: "none", agents: [] });
  });

  it("--add with --template is contradictory", async () => {
    await expect(
      resolveScaffoldOptions({ add: true, template: "starter", interactive: false }, scripted({})),
    ).rejects.toThrow(/--add and --template/);
  });

  it("bare interactive run detects the cwd package.json and offers add", async () => {
    const cwd = await tmp();
    await writeFile(join(cwd, "package.json"), '{"name":"my-api"}');
    const p = scripted({ select: ["add", "none"], multiselect: [[]] });
    const out = await resolveScaffoldOptions({ interactive: true, cwd }, p);
    expect(out).toEqual({ kind: "add", dir: cwd, ide: "none", agents: [] });
  });

  it("detection: choosing new project continues into the normal flow", async () => {
    const cwd = await tmp();
    await writeFile(join(cwd, "package.json"), '{"name":"my-api"}');
    const p = scripted({ select: ["new", "empty", "none"], text: ["fresh-app"], multiselect: [[]] });
    const out = await resolveScaffoldOptions({ interactive: true, cwd }, p);
    expect(out).toEqual({
      kind: "scaffold",
      dir: "fresh-app",
      template: "empty",
      force: false,
      ide: "none",
      agents: [],
    });
  });

  it("a dir argument bypasses detection", async () => {
    const cwd = await tmp();
    await writeFile(join(cwd, "package.json"), '{"name":"my-api"}');
    const p = scripted({ select: ["starter", "none"], multiselect: [[]] });
    const out = await resolveScaffoldOptions({ dir: "sub", interactive: true, cwd }, p);
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
      ide: "none",
      agents: [],
    });
  });

  it("non-empty target WITH package.json offers add", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "package.json"), '{"name":"existing"}');
    const p = scripted({ select: ["add", "none"], multiselect: [[]] });
    const out = await resolveScaffoldOptions({ dir, template: "starter", interactive: true }, p);
    expect(out).toEqual({ kind: "add", dir, ide: "none", agents: [] });
  });

  it("non-empty target WITH package.json can still scaffold fresh", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "package.json"), '{"name":"existing"}');
    const p = scripted({ select: ["fresh", "none"], multiselect: [[]] });
    const out = await resolveScaffoldOptions({ dir, template: "starter", interactive: true }, p);
    expect(out).toEqual({ kind: "scaffold", dir, template: "starter", force: true, ide: "none", agents: [] });
  });

  it("non-empty target WITHOUT package.json keeps the remove-confirm", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "keep.txt"), "x");
    const p = scripted({ confirm: [true], select: ["none"], multiselect: [[]] });
    const out = await resolveScaffoldOptions({ dir, template: "starter", interactive: true }, p);
    expect(out).toEqual({ kind: "scaffold", dir, template: "starter", force: true, ide: "none", agents: [] });
  });
});

describe("resolveScaffoldOptions — editor step", () => {
  it("choosing VS Code carries ide through the scaffold outcome", async () => {
    const p = scripted({ select: ["starter", "vscode"], multiselect: [[]] });
    const out = await resolveScaffoldOptions({ dir: "d", interactive: true }, p);
    expect(out).toEqual({
      kind: "scaffold",
      dir: "d",
      template: "starter",
      force: false,
      ide: "vscode",
      agents: [],
    });
  });

  it("the add path asks the editor question too", async () => {
    const cwd = await tmp();
    await writeFile(join(cwd, "package.json"), '{"name":"my-api"}');
    const p = scripted({ select: ["add", "vscode"], multiselect: [[]] });
    const out = await resolveScaffoldOptions({ interactive: true, cwd }, p);
    expect(out).toEqual({ kind: "add", dir: cwd, ide: "vscode", agents: [] });
  });

  it("--ide vscode skips the prompt", async () => {
    const p = scripted({ select: ["starter"], multiselect: [[]] });
    const out = await resolveScaffoldOptions({ dir: "d", ide: "vscode", interactive: true }, p);
    expect(out).toEqual({
      kind: "scaffold",
      dir: "d",
      template: "starter",
      force: false,
      ide: "vscode",
      agents: [],
    });
  });

  it("--ide none silences the prompt", async () => {
    const out = await resolveScaffoldOptions(
      { dir: "d", template: "starter", ide: "none", interactive: true },
      scripted({ multiselect: [[]] }),
    );
    expect(out).toEqual({ kind: "scaffold", dir: "d", template: "starter", force: false, ide: "none", agents: [] });
  });

  it("rejects an invalid --ide listing valid values", async () => {
    await expect(
      resolveScaffoldOptions({ dir: "d", ide: "emacs", interactive: false }, scripted({})),
    ).rejects.toThrow(/invalid --ide "emacs".*vscode.*none/);
  });

  it("cancelling the editor select cancels the flow", async () => {
    const p = scripted({ select: ["starter"] }); // editor select consumes past the queue -> null
    const out = await resolveScaffoldOptions({ dir: "d", interactive: true }, p);
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

describe("resolveScaffoldOptions — agents step", () => {
  it("asks after the editor step and carries the selection", async () => {
    const p = scripted({ select: ["starter", "none"], multiselect: [["claude", "agents-md"]] });
    const out = await resolveScaffoldOptions({ dir: "d", interactive: true }, p);
    expect(out).toEqual({
      kind: "scaffold",
      dir: "d",
      template: "starter",
      force: false,
      ide: "none",
      agents: ["claude", "agents-md"],
    });
  });

  it("the add path asks the agents question too", async () => {
    const cwd = await tmp();
    await writeFile(join(cwd, "package.json"), '{"name":"my-api"}');
    const p = scripted({ select: ["add", "none"], multiselect: [["agents-md"]] });
    const out = await resolveScaffoldOptions({ interactive: true, cwd }, p);
    expect(out).toEqual({ kind: "add", dir: cwd, ide: "none", agents: ["agents-md"] });
  });

  it("--agents skips the prompt (comma list)", async () => {
    const p = scripted({ select: ["starter", "none"] });
    const out = await resolveScaffoldOptions({ dir: "d", agents: "cursor,copilot", interactive: true }, p);
    expect(out).toMatchObject({ kind: "scaffold", agents: ["cursor", "copilot"] });
  });

  it("--agents none silences the prompt", async () => {
    const out = await resolveScaffoldOptions(
      { dir: "d", template: "starter", ide: "none", agents: "none", interactive: true },
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

  it("cancelling the agents multiselect cancels the flow", async () => {
    const p = scripted({ select: ["starter", "none"] }); // multiselect queue empty -> null
    const out = await resolveScaffoldOptions({ dir: "d", interactive: true }, p);
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
