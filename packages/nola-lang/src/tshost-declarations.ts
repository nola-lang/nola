import { collectCompanionEntries } from "./companions.js";
import { createLoweredProgram, type LoweredEntry } from "./tshost.js";

/**
 * Declaration text per lowered .tsi, from one shared lowered program —
 * extracted from cmdBuild so `nola build` (--out pair) and
 * `nola declarations` (adjacent d.tsi.ts) cannot drift.
 */
export async function emitDeclarationTexts(
  lowered: LoweredEntry[],
  metas: string[][],
  sourceRoot: string,
  projectDir: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (lowered.length === 0) return out;
  const companionEntries = await collectCompanionEntries(
    lowered.map((entry, i) => ({ file: entry.file, companions: metas[i] ?? [] })),
    sourceRoot,
  );
  const { program, virtualName } = createLoweredProgram(lowered, projectDir, "declarations", companionEntries.virtual);
  for (const entry of lowered) {
    const sourceFile = program.getSourceFile(virtualName(entry.file));
    if (!sourceFile) continue;
    let declarationText = "";
    program.emit(
      sourceFile,
      (fileName, text) => {
        if (fileName.endsWith(".d.ts")) declarationText = text;
      },
      undefined,
      true,
    );
    if (declarationText) out.set(entry.file, declarationText);
  }
  return out;
}
