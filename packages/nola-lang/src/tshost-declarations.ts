import { createLoweredProgram, type LoweredEntry, type LoweredProgramHooks } from "./tshost.js";

export interface DeclarationTexts {
  /** .tsi source path -> its declaration text */
  tsi: Map<string, string>;
  /** viewed plain-module source path (x.ts / x.d.ts) -> the view's declaration text */
  views: Map<string, string>;
}

/**
 * Declaration text per lowered .tsi — and per VIEW the program reached —
 * from one shared lowered program, extracted from cmdBuild so `nola build`
 * (--out pairs) and `nola declarations` (adjacent d.tsi.ts) cannot drift.
 */
export async function emitDeclarationTexts(
  lowered: LoweredEntry[],
  sourceRoot: string,
  projectDir: string,
  hooks: LoweredProgramHooks = {},
): Promise<DeclarationTexts> {
  const tsi = new Map<string, string>();
  const viewTexts = new Map<string, string>();
  // No early return on an empty `lowered`: a project with no .tsi at all can
  // still reach views from its plain .ts roots (`import { User } from
  // "./models.tsi"` — the types-only use of Nola), and those need their
  // declaration and built pair exactly like views reached from a .tsi.
  const { program, virtualName, views } = createLoweredProgram(lowered, projectDir, "declarations", sourceRoot, hooks);
  const emitOne = (fileName: string): string => {
    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) return "";
    let declarationText = "";
    program.emit(
      sourceFile,
      (name, text) => {
        if (name.endsWith(".d.ts")) declarationText = text;
      },
      undefined,
      true,
    );
    return declarationText;
  };
  for (const entry of lowered) {
    const text = emitOne(virtualName(entry.file));
    if (text) tsi.set(entry.file, text);
  }
  for (const [virt, src] of views) {
    const text = emitOne(virt);
    if (text) viewTexts.set(src, text);
  }
  return { tsi, views: viewTexts };
}
