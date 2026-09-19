import { compileNola } from "@nola-lang/compiler";
import { derivationDiagnostics } from "@nola-lang/derive";
import { NolaVirtualCode } from "@nola-lang/language-core";
import type { LanguageServicePlugin } from "@volar/language-service";
import type ts from "typescript";
import type { Provide } from "volar-service-typescript";
import { URI } from "vscode-uri";

/**
 * The one hand-written service plugin.
 *
 * Diagnostics: publishes nola-native (parse + lower) errors the TypeScript
 * layer cannot see. Volar's diagnostics worker runs plugins against every
 * code of a file that has generated code whose mappings admit verification —
 * the ROOT code (the .tsi source, identity-mapped) included. That is where
 * the NolaVirtualCode's diagnostics go, at their source offsets, untouched;
 * the embedded TypeScript document carries only the lazy derivation pass.
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
export function createNolaServicePlugin(typescript: typeof ts, options: { sourceRoot: string }): LanguageServicePlugin {
  const { sourceRoot } = options;
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

          if (virtualCode === root) {
            // The .tsi source itself — Volar visits the root code too, through
            // its identity mapping (NolaVirtualCode.rootMapping). nola-native
            // diagnostics carry SOURCE offsets, so they are published here as
            // they are. Never through the embedded mappings: after a bailed
            // parse those describe the last-good text, not this snapshot, and
            // an error past their extent (a `<T>` typed at the end of the
            // file) simply vanished.
            return root.diagnostics.map((d) => ({
              range: { start: document.positionAt(d.start), end: document.positionAt(Math.max(d.end, d.start)) },
              severity: 1 as const,
              code: d.code,
              source: "nola",
              message: d.message,
            }));
          }

          const out = [];
          // The lazy derivation pass (spec §7): the embedded code is phase-1
          // output, so underivable types are found here against the live
          // program. Generated offsets — this IS the embedded document.
          const ls =
            typeof context.inject === "function"
              ? context.inject<Provide, "typescript/languageService">("typescript/languageService")
              : undefined;
          const program = ls?.getProgram();
          const fileName = decoded[0].fsPath.replace(/\\/g, "/");
          const programFile = program?.getSourceFile(fileName);
          if (program && programFile && root.derivations.length > 0) {
            // the program's text is Volar's source-shaped whitespace shadow + this embedded text
            const leadingOffset = programFile.text.length - virtualCode.snapshot.getLength();
            for (const d of derivationDiagnostics(program, fileName, root.derivations, { sourceRoot, leadingOffset })) {
              out.push({
                range: { start: document.positionAt(d.generatedStart), end: document.positionAt(d.generatedEnd) },
                severity: 1 as const,
                code: d.code,
                source: "nola",
                message: d.message,
              });
            }
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
