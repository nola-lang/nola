import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Codes } from "@nola-lang/ast";
import { compileNola } from "@nola-lang/compiler";
import { findProjectRoot, loadCompilerOptions } from "@nola-lang/node-loader";
import { printDiagnostics } from "./diag.js";
import type { LoweredEntry } from "./tshost.js";
import { emitDeclarationTexts } from "./tshost-declarations.js";
import { walkProject } from "./walk.js";

/** report.tsi → report.d.tsi.ts, adjacent — TS allowArbitraryExtensions resolves it. */
export function adjacentDeclarationPath(tsiFile: string): string {
  return `${tsiFile.slice(0, -".tsi".length)}.d.tsi.ts`;
}

/**
 * Emit <base>.d.tsi.ts next to each .tsi so PLAIN tsc (and framework builds
 * like `next build`) resolve .tsi imports via allowArbitraryExtensions.
 * The editor hides these when the sibling .tsi exists; `nola check` excludes
 * them from roots.
 */
export async function emitAdjacentDeclarations(dirArg = "."): Promise<{ written: string[]; errors: string[] }> {
  const dir = resolve(dirArg);
  const sourceRoot = findProjectRoot(dir);
  const { underivableContextType } = await loadCompilerOptions(dir);
  const written: string[] = [];
  const errors: string[] = [];

  const { tsi, reserved } = await walkProject(dir);
  for (const file of reserved) {
    errors.push(
      `${file} ${Codes.ReservedCompanionPath}: the *.nola.* filename namespace is reserved for generated companion modules — rename this file`,
    );
  }
  if (errors.length > 0) return { written, errors };

  const lowered: LoweredEntry[] = [];
  const metas: string[][] = [];
  for (const file of tsi) {
    const source = await readFile(file, "utf8");
    const result = compileNola(source, file, { sourceRoot, underivableContextType });
    if (result.diagnostics.length > 0) {
      errors.push(printDiagnostics(result.diagnostics, () => source));
      continue;
    }
    lowered.push({ file, loweredCode: result.code });
    metas.push(result.meta.companions);
  }

  const texts = await emitDeclarationTexts(lowered, metas, sourceRoot, dir);
  for (const [file, text] of texts) {
    const dtsPath = adjacentDeclarationPath(file);
    await writeFile(dtsPath, text);
    written.push(dtsPath);
  }
  return { written, errors };
}
