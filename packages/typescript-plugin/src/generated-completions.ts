import { isGeneratedIdentifier } from "@nola-lang/compiler";
import type ts from "typescript";

/**
 * Identifier completion at any expression position of a .tsi lists the scope
 * of the LOWERED file — the runtime import `__nola`, the executor's `__frame`,
 * `__nola_module_ctx`, `__nola_type_…`, `__nola_ctx_N` — names the author
 * never wrote and must not use. Applied to the INNER service like the
 * derivation diagnostics, so Volar's proxy maps what is left as before. A
 * plain .ts file's names are the author's, so it is left alone; nothing else
 * on the result is touched.
 */
export function decorateLanguageServiceHideGeneratedCompletions(languageService: ts.LanguageService): void {
  const prior = languageService.getCompletionsAtPosition.bind(languageService);
  languageService.getCompletionsAtPosition = (fileName, position, options, formattingSettings) => {
    const info = prior(fileName, position, options, formattingSettings);
    if (!info || !fileName.endsWith(".tsi")) return info;
    const entries = info.entries.filter((entry) => !isGeneratedIdentifier(entry.name));
    return entries.length === info.entries.length ? info : { ...info, entries };
  };
}
