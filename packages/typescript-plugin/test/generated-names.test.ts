// The tsserver plugin hides the names the lowering generates on a .tsi: an
// unused `__nola_ctx_N` (TS6133 — an item no ask sees) from the semantic and
// suggestion diagnostics, and `__nola…` / `__frame` from completion. A plain
// .ts file's names are the author's, so it is never filtered.
import {
  decorateLanguageServiceHideGeneratedCompletions,
  decorateLanguageServiceWithDerivationDiagnostics,
} from "@nola-lang/typescript-plugin";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const unused = (name: string): ts.Diagnostic => ({
  file: undefined,
  start: 0,
  length: name.length,
  category: ts.DiagnosticCategory.Error,
  code: 6133,
  messageText: `'${name}' is declared but its value is never read.`,
});

const texts = (diagnostics: readonly ts.Diagnostic[]) =>
  diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));

const NAMES = ["__nola", "__frame", "__nola_module_ctx", "__nola_type_$1", "__nola_ctx_1", "oncall", "console"];

describe("tsserver plugin: generated names", () => {
  it("drops TS6133 on a generated name from a .tsi's semantic and suggestion diagnostics, keeps the author's", () => {
    const service = {
      getSemanticDiagnostics: () => [unused("__nola_ctx_1"), unused("foo")],
      getSuggestionDiagnostics: () => [unused("__nola_ctx_1"), unused("foo")],
      getProgram: () => undefined,
    } as unknown as ts.LanguageService;
    decorateLanguageServiceWithDerivationDiagnostics(ts, service, () => undefined, { sourceRoot: "/p" });

    const foo = "'foo' is declared but its value is never read.";
    expect(texts(service.getSemanticDiagnostics("/p/a.tsi"))).toEqual([foo]);
    expect(texts(service.getSuggestionDiagnostics("/p/a.tsi"))).toEqual([foo]);
    expect(service.getSemanticDiagnostics("/p/a.ts")).toHaveLength(2);
    expect(service.getSuggestionDiagnostics("/p/a.ts")).toHaveLength(2);
  });

  it("reads a chained message too", () => {
    const chained: ts.Diagnostic = {
      ...unused("__nola_ctx_2"),
      messageText: { messageText: "'__nola_ctx_2' is declared but its value is never read.", category: 1, code: 6133 },
    };
    const service = {
      getSemanticDiagnostics: () => [chained],
      getSuggestionDiagnostics: () => [chained],
      getProgram: () => undefined,
    } as unknown as ts.LanguageService;
    decorateLanguageServiceWithDerivationDiagnostics(ts, service, () => undefined, { sourceRoot: "/p" });
    expect(service.getSuggestionDiagnostics("/p/a.tsi")).toEqual([]);
  });

  it("drops generated names from a .tsi's completion entries and leaves the rest of the result untouched", () => {
    const entry = (name: string): ts.CompletionEntry => ({
      name,
      kind: ts.ScriptElementKind.variableElement,
      kindModifiers: "",
      sortText: "11",
    });
    const info: ts.CompletionInfo = {
      isGlobalCompletion: true,
      isMemberCompletion: false,
      isNewIdentifierLocation: false,
      optionalReplacementSpan: { start: 3, length: 3 },
      entries: NAMES.map(entry),
    };
    const service = { getCompletionsAtPosition: () => info } as unknown as ts.LanguageService;
    decorateLanguageServiceHideGeneratedCompletions(service);

    const result = service.getCompletionsAtPosition("/p/a.tsi", 3, undefined);
    expect(result?.entries.map((e) => e.name)).toEqual(["oncall", "console"]);
    expect({ ...result, entries: [] }).toEqual({ ...info, entries: [] });
    expect(service.getCompletionsAtPosition("/p/a.ts", 3, undefined)).toBe(info);
  });
});
