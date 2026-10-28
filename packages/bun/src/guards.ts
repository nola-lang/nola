import { basename } from "node:path";
import { Codes } from "@nola-lang/ast";
import { isWiringId } from "./wiring.js";

/**
 * NOLA3023: the Bun floor is 1.3.0 — the first minor with `process.getBuiltinModule`,
 * the libraries' only route to Node builtins (core's host seam). Under Node there is
 * nothing to assert. Without this check an old Bun fails later inside record()/replay()
 * with the seam's "Node >= 22.3 is required" wording, which is wrong there.
 */
export function assertBunVersion(
  versions: Record<string, string | undefined> = process.versions,
  hasGetBuiltinModule: boolean = typeof (process as { getBuiltinModule?: unknown }).getBuiltinModule === "function",
): void {
  if (versions.bun === undefined || hasGetBuiltinModule) return;
  throw new Error(
    `${Codes.BunVersionUnsupported}: Bun >= 1.3.0 is required by @nola-lang/bun ` +
      `(process.getBuiltinModule is missing in Bun ${versions.bun}). Upgrade Bun: \`bun upgrade\`.`,
  );
}

/** NOLA4001: a `Bun.build` for a browser target is a client bundle — .tsi is server-only in v0 (the runtime's NOLA3013 stays as the backstop). */
export function guardBrowserTarget(config: { target?: string } | undefined): void {
  if (config?.target !== "browser") return;
  throw new Error(
    `${Codes.TsiInClientBundle}: .tsi modules are server-only in Nola v0 — this Bun.build targets the browser. ` +
      'Build with target "bun" (or "node") and keep .tsi imports behind a server boundary.',
  );
}

/** NOLA3012 parity with the loader and the bundler plugins: the immediate importer is all a plugin sees. */
export function guardConfigGraphTsi(specifier: string, importer: string | undefined): void {
  if (!specifier.endsWith(".tsi") || importer === undefined) return;
  if (isWiringId(importer) || basename(importer) === "nola.config.ts") {
    throw new Error(
      `${Codes.ConfigImportsTsi}: nola.config.ts cannot import ".tsi" modules ("${specifier}" imported from ${importer}) — ` +
        "the config must be evaluable before Nola modules load.",
    );
  }
}
