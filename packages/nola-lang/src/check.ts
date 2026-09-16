import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import type { CompileResult } from "@nola-lang/compiler";
import { findProjectRoot, loadCompilerOptions } from "@nola-lang/node-loader";
import ts from "typescript";
import { createProjectDeriver } from "./derive.js";
import { printDiagnostics } from "./diag.js";
import { createLoweredProgram, type LoweredEntry } from "./tshost.js";
import { danglingViewErrors } from "./views.js";
import { siblingWarning, walkProject } from "./walk.js";

export async function cmdCheck(dirArg = "."): Promise<{ errors: string[]; warnings: string[] }> {
  const dir = resolve(dirArg);
  // Check the same text `nola build` emits, so the two can't drift.
  const sourceRoot = findProjectRoot(dir);
  const { underivableContextType } = await loadCompilerOptions(dir);
  const errors: string[] = [];
  const { tsi, siblings } = await walkProject(dir);
  const warnings = siblings.map(siblingWarning);

  const entries: LoweredEntry[] = [];
  const maps = new Map<string, CompileResult["map"]>();
  const deriver = createProjectDeriver(dir, sourceRoot, underivableContextType);

  try {
    for (const file of tsi) {
      const source = await readFile(file, "utf8");
      // phase 1 + the checker pass: NOLA2002 / NOLA2008 arrive with the lowering diagnostics
      const result = deriver.lower(file, source);
      if (result.diagnostics.length > 0) {
        errors.push(printDiagnostics(result.diagnostics, () => source));
        continue;
      }
      entries.push({ file, loweredCode: result.code });
      maps.set(file, result.map);
      errors.push(...danglingViewErrors(file, result.meta.views));
    }
    if (entries.length === 0) return { errors, warnings };

    const { program, virtualName, views } = createLoweredProgram(entries, dir, "check", sourceRoot, {
      deriveView: deriver.viewCode,
    });
    const virtualToFile = new Map(entries.map((e) => [virtualName(e.file).replace(/\\/g, "/"), e.file]));

    for (const d of ts.getPreEmitDiagnostics(program)) {
      if (!d.file || d.start === undefined) continue;
      const fileName = d.file.fileName.replace(/\\/g, "/");
      const message = ts.flattenDiagnosticMessageText(d.messageText, " ");
      const viewSource = views.get(fileName);
      if (viewSource) {
        // Diagnostics policy: never report into a file the user cannot open.
        errors.push(`${viewSource}:1:1 TS${d.code}: in derived type module: ${message}`);
        continue;
      }
      const original = virtualToFile.get(fileName);
      if (!original) {
        // A real on-disk file (a plain .ts project root): position it directly.
        const pos = d.file.getLineAndCharacterOfPosition(d.start);
        errors.push(`${d.file.fileName}:${pos.line + 1}:${pos.character + 1} TS${d.code}: ${message}`);
        continue;
      }
      const generated = d.file.getLineAndCharacterOfPosition(d.start);
      const tracer = new TraceMap(maps.get(original) as never);
      const pos = originalPositionFor(tracer, { line: generated.line + 1, column: generated.character });
      const line = pos.line ?? generated.line + 1;
      const column = (pos.column ?? generated.character) + 1;
      errors.push(`${original}:${line}:${column} TS${d.code}: ${message}`);
    }
    return { errors, warnings };
  } finally {
    deriver.dispose();
  }
}
