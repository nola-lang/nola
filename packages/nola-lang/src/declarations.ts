import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { findProjectRoot, loadCompilerOptions } from "@nola-lang/node-loader";
import { createProjectDeriver } from "./derive.js";
import { printDiagnostics } from "./diag.js";
import type { LoweredEntry } from "./tshost.js";
import { emitDeclarationTexts } from "./tshost-declarations.js";
import { danglingViewErrors } from "./views.js";
import { siblingWarning, walkProject } from "./walk.js";

/** report.tsi → report.d.tsi.ts, adjacent — TS allowArbitraryExtensions resolves it. */
export function adjacentDeclarationPath(tsiFile: string): string {
  return `${tsiFile.slice(0, -".tsi".length)}.d.tsi.ts`;
}

/** models.ts / api.d.ts → models.d.tsi.ts / api.d.tsi.ts: the declaration of the module's VIEW. */
export function adjacentViewDeclarationPath(viewSourceFile: string): string {
  return `${viewSourceFile.replace(/\.d\.ts$|\.ts$/, "")}.d.tsi.ts`;
}

/**
 * Emit <base>.d.tsi.ts next to each .tsi — and next to each plain module
 * reached as a VIEW — so PLAIN tsc (and framework builds like `next build`)
 * resolve `.tsi` imports via allowArbitraryExtensions. The editor hides these
 * when the sibling .tsi exists; `nola check` excludes them from roots.
 */
export async function emitAdjacentDeclarations(
  dirArg = ".",
): Promise<{ written: string[]; errors: string[]; warnings: string[] }> {
  const dir = resolve(dirArg);
  const sourceRoot = findProjectRoot(dir);
  const { underivableContextType } = await loadCompilerOptions(dir);
  const written: string[] = [];
  const errors: string[] = [];

  const { tsi, siblings } = await walkProject(dir);
  const warnings = siblings.map(siblingWarning);

  const lowered: LoweredEntry[] = [];
  const deriver = createProjectDeriver(dir, sourceRoot, underivableContextType);
  let decl: Awaited<ReturnType<typeof emitDeclarationTexts>>;
  try {
    for (const file of tsi) {
      const source = await readFile(file, "utf8");
      const result = deriver.lower(file, source);
      if (result.diagnostics.length > 0) {
        errors.push(printDiagnostics(result.diagnostics, () => source));
        continue;
      }
      lowered.push({ file, loweredCode: result.code });
      errors.push(...danglingViewErrors(file, result.meta.views));
    }
    decl = await emitDeclarationTexts(lowered, sourceRoot, dir, { deriveView: deriver.viewCode });
  } finally {
    deriver.dispose();
  }
  for (const [file, text] of decl.tsi) {
    const dtsPath = adjacentDeclarationPath(file);
    await writeFile(dtsPath, text);
    written.push(dtsPath);
  }
  for (const [src, text] of decl.views) {
    // tshost keys views by posix path; `resolve` restores the platform form for `written`
    const dtsPath = adjacentViewDeclarationPath(resolve(src));
    await writeFile(dtsPath, text);
    written.push(dtsPath);
  }
  return { written, errors, warnings };
}
