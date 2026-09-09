import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PackageManager } from "./package-manager.js";

/**
 * The last, optional step of the scaffold flow — "Install dependencies and
 * open VS Code?" — runs two external commands. This is the seam the flow
 * calls; tests inject a recorder, the CLI uses `realLauncher`.
 */
export interface Launcher {
  /**
   * `<pm> install` in the project dir. Its output (stdout + stderr, as it
   * arrives) goes to `onOutput` instead of the terminal, so the flow can keep
   * a spinner over it and show the tail only when the install fails; resolves
   * to the exit code (1 when the command could not be spawned at all).
   */
  install(pm: PackageManager, dir: string, onOutput: (chunk: string) => void): Promise<number>;
  /** `code <dir>`, detached; "not-found" when VS Code's `code` command is not on PATH. */
  openVscode(dir: string): Promise<"opened" | "not-found">;
}

/**
 * Locate an executable on PATH the way a shell would: every PATH entry, and
 * on Windows every PATHEXT extension (`code` is `code.cmd` there). Pure —
 * env and platform are parameters so it is testable off-platform.
 */
export function findOnPath(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const pathValue = env.PATH ?? env.Path ?? env.path ?? "";
  const dirs = pathValue.split(platform === "win32" ? ";" : ":").filter((d) => d.length > 0);
  // Windows: ONLY the PATHEXT forms — VS Code's bin dir also holds an
  // extensionless `code`, a POSIX shell shim that cmd.exe cannot run.
  const exts = platform === "win32" ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map((e) => e.toLowerCase()) : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, `${name}${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

const WINDOWS = process.platform === "win32";
/**
 * On Windows both commands run through a shell (`npm`/`pnpm`/`code` are .cmd
 * shims there, and Node refuses to spawn those directly), and a shell needs
 * paths with spaces quoted — "C:\…\Microsoft VS Code\bin\code.cmd" is the
 * normal case. Only strings that contain whitespace are quoted: quoting a
 * bare command name breaks some .cmd shims (nvm-windows' npm.cmd, verified).
 * Off Windows nothing is quoted (no shell).
 */
const q = (s: string): string => (WINDOWS && /\s/.test(s) ? `"${s}"` : s);

function run(command: string, args: string[], cwd: string, onOutput: (chunk: string) => void): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(q(command), args.map(q), { cwd, stdio: ["ignore", "pipe", "pipe"], shell: WINDOWS });
    child.stdout?.on("data", (chunk: Buffer | string) => onOutput(String(chunk)));
    child.stderr?.on("data", (chunk: Buffer | string) => onOutput(String(chunk)));
    child.on("error", (err) => {
      onOutput(`${err.message}\n`);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/**
 * The install command's arguments per manager. npm audits on every install
 * with a POST to the registry's advisory endpoint; on a network that drops
 * that request the scaffold sat on npm's spinner for minutes with nothing
 * to show (reproduced 2026-09-03: the audit request alone took 190 s, the
 * install itself 1 s). The scaffold gains nothing from the audit or the
 * funding notice, so npm runs without them. pnpm, yarn and bun have no
 * such step on install and take a plain `install`.
 */
export function installArgs(pm: PackageManager): string[] {
  return pm === "npm" ? ["install", "--no-audit", "--no-fund"] : ["install"];
}

export const realLauncher: Launcher = {
  install: (pm, dir, onOutput) => run(pm, installArgs(pm), dir, onOutput),
  async openVscode(dir) {
    const code = findOnPath("code");
    if (!code) return "not-found";
    // Detached + ignored stdio: the CLI exits while VS Code keeps running.
    const child = spawn(q(code), [q(dir)], { detached: true, stdio: "ignore", shell: WINDOWS });
    child.on("error", () => {});
    child.unref();
    return "opened";
  },
};
