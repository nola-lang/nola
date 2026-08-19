/**
 * Which package manager invoked us. `npm create nola`, `pnpm create nola`,
 * `yarn create nola` and `bun create nola` all run the same bin, and each
 * manager stamps itself into `npm_config_user_agent` ("pnpm/10.23.0 npm/? …").
 * Only the printed "Next steps" depend on it — the scaffolded files are
 * manager-agnostic — so an unknown or missing agent falls back to npm.
 */
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export function detectPackageManager(userAgent = process.env.npm_config_user_agent): PackageManager {
  const name = userAgent?.split("/")[0]?.trim();
  return name === "pnpm" || name === "yarn" || name === "bun" ? name : "npm";
}

export interface PackageManagerCommands {
  install: string;
  start: string;
  /** prefix for a named script: `${run} check` (yarn classic's builtin `check` shadows a bare `yarn check`) */
  run: string;
}

export function packageManagerCommands(pm: PackageManager): PackageManagerCommands {
  return { install: `${pm} install`, start: `${pm} start`, run: `${pm} run` };
}
