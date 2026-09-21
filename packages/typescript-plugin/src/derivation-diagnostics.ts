import { derivationDiagnostics } from "@nola-lang/derive";
import { NolaVirtualCode } from "@nola-lang/language-core";
import type { Language } from "@volar/language-core";
import type ts from "typescript";

/**
 * Wrap the INNER language service's getSemanticDiagnostics with the lazy
 * derivation pass (spec §7). Applied to the service Volar is about to proxy —
 * in the tsserver plugin's create callback, `info.languageService` is still
 * the inner one — so the diagnostics carry GENERATED offsets on the generated
 * SourceFile and Volar's proxy maps them back to the .tsi like TypeScript's
 * own. NOLA codes ride `code` as their number (2002 / 2008 / 2007) with
 * `source: "nola"` and the code spelled in the message.
 */
export function decorateLanguageServiceWithDerivationDiagnostics(
  typescript: typeof ts,
  languageService: ts.LanguageService,
  getLanguage: () => Language<string> | undefined,
  options: { sourceRoot: string },
): void {
  const prior = languageService.getSemanticDiagnostics.bind(languageService);
  languageService.getSemanticDiagnostics = (fileName) => {
    const base = prior(fileName);
    if (!fileName.endsWith(".tsi")) return base;
    const program = languageService.getProgram();
    const root = getLanguage()?.scripts.get(fileName)?.generated?.root;
    if (!program || !(root instanceof NolaVirtualCode)) return base;
    const sf = program.getSourceFile(fileName);
    if (!sf) return base;
    // the program's text is Volar's source-shaped whitespace shadow + the
    // generated code — verified by the pass, which answers nothing when the
    // program is not at the virtual code's version (see derive's diagnostics.ts)
    const snapshot = root.embeddedCodes[0].snapshot;
    const generatedText = snapshot.getText(0, snapshot.getLength());
    const leadingOffset = sf.text.length - generatedText.length;
    const derived = derivationDiagnostics(program, fileName, root.derivations, { ...options, generatedText });
    if (!derived) return base;
    const extra = derived.map(
      (d): ts.Diagnostic => ({
        file: sf,
        start: d.generatedStart + leadingOffset,
        length: d.generatedEnd - d.generatedStart,
        category: typescript.DiagnosticCategory.Error,
        code: Number(d.code.slice("NOLA".length)),
        messageText: `${d.code}: ${d.message}`,
        source: "nola",
      }),
    );
    return extra.length > 0 ? [...base, ...extra] : base;
  };
}
