import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { Codes } from "@nola-lang/ast";
import { type CompileResult, compileNola } from "@nola-lang/compiler";
import { findProjectRoot, loadCompilerOptions } from "@nola-lang/node-loader";
import ts from "typescript";
import { collectCompanionEntries } from "./companions.js";
import { printDiagnostics } from "./diag.js";
import { createLoweredProgram, type LoweredEntry } from "./tshost.js";
import { walkProject } from "./walk.js";

export async function cmdCheck(dirArg = "."): Promise<{ errors: string[] }> {
  const dir = resolve(dirArg);
  // Check the same text `nola build` emits, so the two can't drift.
  const sourceRoot = findProjectRoot(dir);
  const { underivableContextType } = await loadCompilerOptions(dir);
  const errors: string[] = [];
  const { tsi, reserved } = await walkProject(dir);
  for (const file of reserved) {
    errors.push(
      `${file} ${Codes.ReservedCompanionPath}: the *.nola.* filename namespace is reserved for generated companion modules — rename this file`,
    );
  }
  if (errors.length > 0) return { errors };

  const entries: LoweredEntry[] = [];
  const maps = new Map<string, CompileResult["map"]>();
  const seeds: Array<{ file: string; companions: string[] }> = [];

  for (const file of tsi) {
    const source = await readFile(file, "utf8");
    const result = compileNola(source, file, { sourceRoot, underivableContextType });
    if (result.diagnostics.length > 0) {
      errors.push(printDiagnostics(result.diagnostics, () => source));
      continue;
    }
    entries.push({ file, loweredCode: result.code });
    maps.set(file, result.map);
    seeds.push({ file, companions: result.meta.companions });
  }
  if (entries.length === 0) return { errors };

  const companionEntries = await collectCompanionEntries(seeds, sourceRoot);
  errors.push(...companionEntries.errors);

  const { program, virtualName } = createLoweredProgram(entries, dir, "check", companionEntries.virtual);
  const virtualToFile = new Map(entries.map((e) => [virtualName(e.file).replace(/\\/g, "/"), e.file]));

  for (const d of ts.getPreEmitDiagnostics(program)) {
    if (!d.file || d.start === undefined) continue;
    const fileName = d.file.fileName.replace(/\\/g, "/");
    const message = ts.flattenDiagnosticMessageText(d.messageText, " ");
    const companionSource = companionEntries.sources.get(fileName);
    if (companionSource) {
      // Diagnostics policy: never report into a file the user cannot open.
      errors.push(`${companionSource}:1:1 TS${d.code}: in derived type module: ${message}`);
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
  return { errors };
}
