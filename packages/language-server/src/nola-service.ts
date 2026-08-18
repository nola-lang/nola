import { compileNola } from "@nola-lang/compiler";
import { NolaVirtualCode } from "@nola-lang/language-core";
import type { LanguageServicePlugin } from "@volar/language-service";
import type ts from "typescript";
import { URI } from "vscode-uri";

/**
 * The one hand-written service plugin.
 *
 * Diagnostics: publishes nola-native (parse + lower) errors the TypeScript
 * layer cannot see. Volar's diagnostics worker runs plugins against the
 * EMBEDDED documents of a file that has generated code — so this plugin
 * decodes the embedded URI back to the source script, reads the
 * NolaVirtualCode's diagnostics (source offsets), translates them into
 * embedded coordinates through Volar's own mapper, and lets the pipeline map
 * them back to the .tsi document.
 *
 * Formatting: runs TypeScript's error-tolerant syntactic formatter over the
 * .tsi SOURCE text (reached through the root code's format-only identity
 * mapping). Formatting the lowered TS instead would be wrong: infer-function
 * bodies are nested one level deeper there (the Intent executor closure), so
 * generated-side indentation maps back double-indented. Edits that touch a
 * nola construct (a replaced source span) are dropped — the TS formatter has
 * no idea what `..` or a tagged infer header means, so only whitespace
 * decisions over plain-TS source regions are trusted.
 */
export function createNolaServicePlugin(typescript: typeof ts): LanguageServicePlugin {
  return {
    name: "nola",
    capabilities: {
      diagnosticProvider: {
        interFileDependencies: false,
        workspaceDiagnostics: false,
      },
      documentFormattingProvider: true,
    },
    create(context) {
      const formatter = createSourceFormatter(typescript);
      return {
        provideDiagnostics(document) {
          const decoded = context.decodeEmbeddedDocumentUri(URI.parse(document.uri));
          if (!decoded) return undefined;
          const sourceScript = context.language.scripts.get(decoded[0]);
          const root = sourceScript?.generated?.root;
          const virtualCode = sourceScript?.generated?.embeddedCodes.get(decoded[1]);
          if (!sourceScript || !virtualCode || !(root instanceof NolaVirtualCode)) return undefined;
          if (root.diagnostics.length === 0) return [];

          const mapper = context.language.maps.get(virtualCode, sourceScript);
          const toGenerated = (sourceOffset: number): number | undefined => {
            for (const [generatedOffset] of mapper.toGeneratedLocation(sourceOffset)) {
              return generatedOffset;
            }
            return undefined;
          };

          const out = [];
          for (const d of root.diagnostics) {
            const start = toGenerated(d.start) ?? toGenerated(d.end);
            if (start === undefined) continue; // outside any mapped span
            const end = toGenerated(d.end) ?? start;
            out.push({
              range: { start: document.positionAt(start), end: document.positionAt(Math.max(end, start)) },
              severity: 1 as const,
              code: d.code,
              source: "nola",
              message: d.message,
            });
          }
          return out;
        },
        provideDocumentFormattingEdits(document, range, options) {
          if (document.languageId !== "nola") return undefined;
          const text = document.getText();
          // Tolerant compile only to learn where the nola constructs are; an
          // irrecoverable parse means the spans are unknown — don't guess.
          const result = compileNola(text, "format.tsi", { tolerant: true });
          if (result.meta.mode !== "lowered") return undefined;
          const constructRanges = result.meta.spans
            .filter((s) => s.kind === "replaced" && s.sourceEnd > s.sourceStart)
            .map((s) => ({ start: s.sourceStart, end: s.sourceEnd }));

          const changes = formatter.format(text, document.offsetAt(range.start), document.offsetAt(range.end), {
            convertTabsToSpaces: options.insertSpaces,
            tabSize: options.tabSize,
            indentSize: options.tabSize,
            indentStyle: typescript.IndentStyle.Smart,
            newLineCharacter: "\n",
            insertSpaceAfterCommaDelimiter: true,
            insertSpaceAfterSemicolonInForStatements: true,
            insertSpaceBeforeAndAfterBinaryOperators: true,
            insertSpaceAfterKeywordsInControlFlowStatements: true,
            insertSpaceAfterFunctionKeywordForAnonymousFunctions: true,
            insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: true,
            insertSpaceAfterOpeningAndBeforeClosingEmptyBraces: true,
            semicolons: typescript.SemicolonPreference.Ignore,
          });

          const edits = [];
          for (const change of changes) {
            const editStart = change.span.start;
            const editEnd = change.span.start + change.span.length;
            const touchesConstruct = constructRanges.some((r) =>
              change.span.length === 0
                ? editStart > r.start && editStart < r.end // pure insertion strictly inside
                : editStart < r.end && r.start < editEnd,
            );
            if (touchesConstruct) continue;
            edits.push({
              range: { start: document.positionAt(editStart), end: document.positionAt(editEnd) },
              newText: change.newText,
            });
          }
          return edits;
        },
      };
    },
  };
}

/**
 * A single-file, syntactic-only TS language service: formatting never touches
 * the program, so no libs, no module resolution. The .tsi text is presented
 * as a .ts script — the formatter is error-tolerant, and whitespace edits in
 * regions it misparses are filtered out by the caller via construct spans.
 */
function createSourceFormatter(typescript: typeof ts) {
  const FILE = "/__nola-format__.ts";
  let text = "";
  let version = 0;
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [FILE],
    getScriptVersion: () => String(version),
    getScriptSnapshot: (f) => (f === FILE ? typescript.ScriptSnapshot.fromString(text) : undefined),
    getCurrentDirectory: () => "/",
    getCompilationSettings: () => ({}),
    getDefaultLibFileName: () => "lib.d.ts",
    fileExists: (f) => f === FILE,
    readFile: (f) => (f === FILE ? text : undefined),
  };
  const service = typescript.createLanguageService(host);
  return {
    format(sourceText: string, start: number, end: number, settings: ts.FormatCodeSettings): ts.TextChange[] {
      text = sourceText;
      version++;
      return service.getFormattingEditsForRange(FILE, start, end, settings);
    },
  };
}
