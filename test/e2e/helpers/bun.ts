import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The `bun` executable the Bun e2e suites spawn, or null when none is installed (the
 * suites skip). Node's execFile takes no shell, so on Windows a `.cmd` shim is not enough:
 * the official installer puts `bun.exe` on PATH, while `npm i -g bun` exposes only a
 * `bun.cmd` wrapping `<global node_modules>/bun/bin/bun.exe` — that file is tried next,
 * beside node.exe (npm's default global prefix on Windows) and under `npm root -g`.
 */
export function findBun(): string | null {
  const candidates = process.platform === "win32" ? ["bun.exe"] : ["bun"];
  if (process.platform === "win32") {
    candidates.push(join(dirname(process.execPath), "node_modules", "bun", "bin", "bun.exe"));
    try {
      candidates.push(join(execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(), "bun", "bin", "bun.exe"));
    } catch {
      // no npm on PATH: the PATH candidate decides
    }
  }
  for (const file of candidates) {
    if (file.includes("/") || file.includes("\\")) {
      if (!existsSync(file)) continue;
    }
    try {
      execFileSync(file, ["--version"], { stdio: "ignore" });
      return file;
    } catch {
      // not this one
    }
  }
  return null;
}

/** Resolved once per worker: the suites gate on it with `describe.skipIf(BUN === null)`. */
export const BUN = findBun();
