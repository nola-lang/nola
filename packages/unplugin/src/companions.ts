import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { Codes } from "@nola-lang/ast";
import { companionSourceCandidates, compileCompanion, isCompanionSpecifier } from "@nola-lang/compiler";
import { transform } from "esbuild";
import { isWiringId } from "./core.js";

export const COMPANION_PREFIX = "\0nola-companion:";

/** Loader-parity resolution (node-loader/hooks.ts): probe candidates next to the importer. */
export function resolveCompanionId(specifier: string, importerFile: string): string | null {
  if (!isCompanionSpecifier(specifier) || !specifier.startsWith(".")) return null;
  const importerDir = dirname(importerFile);
  const literal = resolve(importerDir, specifier);
  if (existsSync(literal)) {
    // Never silently shadow: a real on-disk *.nola.* file is a reserved-namespace violation.
    throw new Error(
      `${Codes.ReservedCompanionPath}: ${literal} matches the reserved *.nola.* companion namespace — rename the file.`,
    );
  }
  for (const candidate of companionSourceCandidates(specifier)) {
    const p = resolve(importerDir, candidate);
    if (existsSync(p)) return `${COMPANION_PREFIX}${p}`;
  }
  throw new Error(
    `${Codes.CompanionUnavailable}: cannot locate the type source for "${specifier}" imported from ${importerFile}`,
  );
}

export async function loadCompanionCode(id: string, sourceRoot: string): Promise<{ code: string; watchFile: string }> {
  const file = id.slice(COMPANION_PREFIX.length);
  const companion = compileCompanion(await readFile(file, "utf8"), file, { sourceRoot });
  if (companion.code === "" || companion.diagnostics.length > 0) {
    throw new Error(companion.diagnostics.map((d) => `${d.file}: ${d.code}: ${d.message}`).join("\n"));
  }
  // Plain TS with no meaningful original positions — strip types, skip the map (loader parity).
  const js = await transform(companion.code, { loader: "ts", format: "esm" });
  return { code: js.code, watchFile: file };
}

/** Best-effort NOLA3012 parity: the immediate importer is all a bundler shows us. */
export function guardConfigGraphTsi(specifier: string, importerFile: string | undefined): void {
  if (!specifier.endsWith(".tsi") || importerFile === undefined) return;
  if (isWiringId(importerFile) || basename(importerFile) === "nola.config.ts") {
    throw new Error(
      `${Codes.ConfigImportsTsi}: nola.config.ts cannot import ".tsi" modules ("${specifier}" imported from ${importerFile}) — the config must be evaluable before Nola modules load.`,
    );
  }
}
