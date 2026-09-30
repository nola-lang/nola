import { isGeneratedIdentifier, isGeneratedNameDiagnostic } from "@nola-lang/compiler";
import type { LanguageServicePlugin } from "@volar/language-service";
import { URI } from "vscode-uri";

/**
 * Wraps one of volar-service-typescript's plugins so the names the lowering
 * generates never reach the author on a .tsi: TypeScript's unused-declaration
 * report on one — an error under noUnusedLocals and greyed-out unused code
 * without it; a context item no ask sees was the case, before its `void`
 * step-location read referenced it — and identifier completion's `__nola`, `__frame`,
 * `__nola_module_ctx`, `__nola_type_…` and `__nola_ctx_N`, in scope at every
 * expression position of the lowered text. The author can act on neither.
 * Only a document embedded in a .tsi is filtered (a plain .ts document's names
 * are the author's); everything else on a result is left as it is.
 */
export function hideGeneratedNames(plugin: LanguageServicePlugin): LanguageServicePlugin {
  return {
    ...plugin,
    create(context) {
      const instance = plugin.create(context);
      const inTsi = (uri: string) =>
        context.decodeEmbeddedDocumentUri(URI.parse(uri))?.[0].path.endsWith(".tsi") === true;
      const provideDiagnostics = instance.provideDiagnostics;
      if (provideDiagnostics) {
        instance.provideDiagnostics = async (document, token) => {
          const diagnostics = await provideDiagnostics.call(instance, document, token);
          if (!diagnostics || !inTsi(document.uri)) return diagnostics;
          return diagnostics.filter(
            (d) =>
              !(
                typeof d.code === "number" &&
                isGeneratedNameDiagnostic(d.code, typeof d.message === "string" ? d.message : d.message.value)
              ),
          );
        };
      }
      const provideCompletionItems = instance.provideCompletionItems;
      if (provideCompletionItems) {
        instance.provideCompletionItems = async (document, position, completionContext, token) => {
          const list = await provideCompletionItems.call(instance, document, position, completionContext, token);
          if (!list || !inTsi(document.uri)) return list;
          const items = list.items.filter((item) => !isGeneratedIdentifier(item.label));
          return items.length === list.items.length ? list : { ...list, items };
        };
      }
      return instance;
    },
  };
}
