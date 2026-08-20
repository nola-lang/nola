import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { capture, ensureBuilt } from "./helpers/ensure-built.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CREATE = join(ROOT, "packages", "create-nola-lang", "dist", "main.js");
const NOLA = join(ROOT, "packages", "nola-lang", "dist", "main.js");

/** Workspace-link the runtime packages the scaffolded app depends on. */
function linkDeps(app: string): void {
  const scope = join(app, "node_modules", "@nola-lang");
  mkdirSync(scope, { recursive: true });
  for (const pkg of ["runtime", "providers"]) {
    symlinkSync(join(ROOT, "packages", pkg), join(scope, pkg), "junction");
  }
}

function run(cmd: string[], cwd: string): Promise<string> {
  return capture(process.execPath, cmd, { cwd });
}

// The launch requirement: a scaffolded project's first `nola run` succeeds
// OFFLINE — answers come from the committed replay ledger, no API key. This
// doubles as a prompt-composition stability guard: wording changes re-key the
// ledger and fail here until the template ledger is re-recorded.
describe("scaffolded project", () => {
  let app: string;

  beforeAll(async () => {
    await ensureBuilt(ROOT);
    const parent = await mkdtemp(join(tmpdir(), "nola-scaffold-e2e-"));
    app = join(parent, "my-app");
    await run([CREATE, app], parent);
    linkDeps(app);
  }, 600_000);

  it("nola run works keylessly via the replay ledger", async () => {
    const out = await run([NOLA, "run", "src/main.ts"], app);
    const lastLine = out.trim().split("\n").at(-1) as string;
    expect(JSON.parse(lastLine)).toEqual({
      name: "Alice Smith",
      age: 32,
      employer: "Acme Corp",
      job: "staff engineer",
    });
  });

  it("nola check passes", async () => {
    const out = await run([NOLA, "check"], app);
    expect(out).toContain("no errors");
  });

  it("nola init lays down the identical starter", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "nola-init-e2e-")), "app2");
    await run([NOLA, "init", dir], ROOT);
    for (const f of ["package.json", "nola.config.ts", "nola.replay.jsonl", ".gitignore", "src/person.tsi", "src/main.ts"]) {
      expect(existsSync(join(dir, f)), f).toBe(true);
    }
  });

  it("scaffolds the empty template and checks clean", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "nola-empty-e2e-")), "app");
    await run([CREATE, dir, "--template", "empty", "--ide", "vscode", "--agents", "all"], ROOT);
    for (const f of ["package.json", "tsconfig.json", "nola.config.ts", ".gitignore", "src/main.ts"]) {
      expect(existsSync(join(dir, f)), f).toBe(true);
    }
    expect(existsSync(join(dir, "nola.replay.jsonl"))).toBe(false);
    for (const f of [".vscode/launch.json", ".vscode/extensions.json"]) {
      expect(existsSync(join(dir, f)), f).toBe(true);
    }
    const launch = JSON.parse(readFileSync(join(dir, ".vscode", "launch.json"), "utf8"));
    expect(launch.configurations[0].runtimeArgs).toContain("nola-lang/register");
    for (const f of [
      ".claude/skills/nola/SKILL.md",
      ".cursor/rules/nola.mdc",
      ".github/instructions/nola.instructions.md",
      "AGENTS.md",
    ]) {
      expect(existsSync(join(dir, f)), f).toBe(true);
    }
    // Adapters are self-contained copies, never pointers into node_modules.
    const agentsMd = readFileSync(join(dir, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("Where Nola diverges from TypeScript");
    expect(agentsMd).toContain("<!-- nola-skill v");
    expect(agentsMd).not.toContain("node_modules/nola-lang/skills");
    for (const ref of ["syntax.md", "patterns.md", "config.md", "pitfalls.md"]) {
      expect(existsSync(join(dir, ".claude", "skills", "nola", "references", ref)), ref).toBe(true);
    }
    linkDeps(dir);
    const out = await run([NOLA, "check"], dir);
    expect(out).toContain("no errors");
  });

  it("scaffolds an example template from the dev checkout, no network", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "nola-example-e2e-")), "app");
    await run([NOLA, "init", dir, "--template", "extract-resume"], ROOT);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(pkg.name).toBe("app");
    expect(pkg.dependencies["@nola-lang/runtime"]).toMatch(/^\^0\./);
    linkDeps(dir);
    const out = await run([NOLA, "run", "src/main.ts"], dir);
    expect(JSON.parse(out.trim())).toEqual({
      name: "Grace Hopper",
      email: "grace@example.com",
      experience: ["United States Navy programmer (1943-1966)", "Eckert-Mauchly, worked on UNIVAC I (1949-1954)"],
      skills: ["COBOL", "compilers"],
      education: [{ school: "Yale University", degree: "PhD in Mathematics", year: 1934 }],
    });
  });

  it("adds Nola to an existing project (nola init --add), idempotently", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-add-e2e-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "existing-api", private: true, type: "module" }, null, 2));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "util.ts"), "export const answer = 42;\n");
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            strict: true,
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            allowArbitraryExtensions: true,
            noEmit: true,
            skipLibCheck: true,
          },
          include: ["src"],
        },
        null,
        2,
      ),
    );
    const out1 = await run([NOLA, "init", dir, "--add", "--ide", "vscode"], ROOT);
    expect(out1).toContain("Added Nola");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(pkg.name).toBe("existing-api");
    expect(pkg.dependencies["@nola-lang/runtime"]).toMatch(/^\^0\./);
    expect(pkg.devDependencies.typescript).toBe("^5.6.0");
    expect(existsSync(join(dir, ".vscode", "extensions.json"))).toBe(true);
    linkDeps(dir);
    const check = await run([NOLA, "check"], dir);
    expect(check).toContain("no errors");
    const again = await run([NOLA, "init", dir, "--add"], ROOT);
    expect(again).toContain("already has Nola");
  });

  it("nola skill install writes adapters into an existing project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-skill-e2e-"));
    writeFileSync(join(dir, "package.json"), '{"name":"existing"}\n');
    const out = await run([NOLA, "skill", "install", "--agents", "agents-md,claude"], dir);
    expect(out).toContain("Installed agent skill files");
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "skills", "nola", "SKILL.md"))).toBe(true);
    // idempotent second run: same version, so nothing is rewritten
    const again = await run([NOLA, "skill", "install", "--agents", "agents-md,claude"], dir);
    expect(again).toContain("already exists");
    expect(again).toContain("is up to date");

    // a stale stamp is held back until --force
    const rule = join(dir, ".cursor", "rules", "nola.mdc");
    mkdirSync(join(dir, ".cursor", "rules"), { recursive: true });
    writeFileSync(rule, "<!-- nola-skill v0.0.1 -->\nstale\n");
    const held = await run([NOLA, "skill", "install", "--agents", "cursor"], dir);
    expect(held).toContain("--force");
    expect(readFileSync(rule, "utf8")).toContain("stale");
    const forced = await run([NOLA, "skill", "install", "--agents", "cursor", "--force"], dir);
    expect(forced).toContain("Installed agent skill files");
    expect(readFileSync(rule, "utf8")).toContain("Where Nola diverges from TypeScript");
  });
});
