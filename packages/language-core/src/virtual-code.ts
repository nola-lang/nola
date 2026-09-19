import type { Diagnostic } from "@nola-lang/ast";
import { compileNola, type DerivationRequest } from "@nola-lang/compiler";
import type { CodeMapping, IScriptSnapshot, VirtualCode } from "@volar/language-core";
import type { EditorCompilerConfig } from "./compiler-config.js";
import { spansToMappings } from "./mappings.js";

function snapshotOf(text: string): IScriptSnapshot {
  return {
    getText: (start, end) => text.slice(start, end),
    getLength: () => text.length,
    getChangeRange: () => undefined,
  };
}

/**
 * Last-good mappings describe the text the embedded code was lowered FROM,
 * not the snapshot being edited, so every feature served through them is
 * approximate. Completion, hover and navigation are asked for at a cursor
 * and degrade gracefully; semantic tokens are painted over the WHOLE
 * document and land on the wrong characters wherever the text has shifted
 * (a type name over the middle of a prompt). Drop only those — the TextMate
 * grammar keeps the file coloured until the parse recovers.
 */
function withoutSemanticTokens(mappings: CodeMapping[]): CodeMapping[] {
  return mappings.map((m) => (m.data.semantic ? { ...m, data: { ...m.data, semantic: false } } : m));
}

/**
 * The Volar face of one .tsi document. The root carries the SOURCE snapshot
 * (languageId "nola"); the single embedded code is the lowered TypeScript.
 * The embeddedCodes list shape is the spec's open door for future
 * representations — exactly one entry today.
 */
export class NolaVirtualCode implements VirtualCode {
  readonly id = "root";
  readonly languageId = "nola";
  mappings: CodeMapping[] = [];
  embeddedCodes: [VirtualCode];
  /** nola-native (parse + lower) diagnostics for the current snapshot */
  diagnostics: Diagnostic[] = [];
  /**
   * The phase-1 derivation requests of the embedded code (emit 15): the
   * accessors the checker would fill in. The editor serves phase-1 output as
   * is and derives lazily on the diagnostics pass — see derivationDiagnostics
   * in @nola-lang/derive, used by the language server and the tsserver plugin.
   */
  derivations: DerivationRequest[] = [];
  /** true when the embedded code is last-good output for an unparsable snapshot */
  stale = false;

  private lastGood: { text: string; mappings: CodeMapping[] } | undefined;

  constructor(
    public snapshot: IScriptSnapshot,
    private readonly fileName: string,
    private readonly sourceRoot: string | undefined,
    private readonly compilerConfig: (fileName: string) => EditorCompilerConfig = () => ({}),
  ) {
    this.embeddedCodes = [this.compute(snapshot)];
    this.mappings = [this.rootMapping()];
  }

  update(snapshot: IScriptSnapshot): void {
    this.snapshot = snapshot;
    this.embeddedCodes = [this.compute(snapshot)];
    this.mappings = [this.rootMapping()];
  }

  /**
   * Identity self-mapping of the root (source-text) document, admitting it
   * into exactly two Volar passes. Formatting: the language server's nola
   * service plugin formats the .tsi source directly, because TS-formatter
   * indentation computed on the LOWERED text maps back wrong (infer bodies
   * are nested one level deeper there). Diagnostics: nola-native errors carry
   * SOURCE offsets, so the same plugin publishes them on this document as
   * they are — never translated through the embedded mappings, which after a
   * bailed parse describe an older text (an error past their extent was
   * dropped). No other feature flag: everything else is served by the
   * embedded TS code's mappings.
   */
  private rootMapping(): CodeMapping {
    return {
      sourceOffsets: [0],
      generatedOffsets: [0],
      lengths: [this.snapshot.getLength()],
      data: { verification: true, format: true },
    };
  }

  private compute(snapshot: IScriptSnapshot): VirtualCode {
    const source = snapshot.getText(0, snapshot.getLength());
    // Config is re-read per compile (mtime-cached), so a nola.config.ts edit
    // takes effect on the next recompile of each file.
    const { underivableContextType } = this.compilerConfig(this.fileName);
    const result = compileNola(source, this.fileName, {
      sourceRoot: this.sourceRoot,
      tolerant: true,
      underivableContextType,
    });
    this.diagnostics = result.diagnostics;
    this.derivations = result.meta.mode === "lowered" ? result.meta.derivations : [];
    if (result.meta.mode === "lowered") {
      const mappings = spansToMappings(result.meta.spans, result.meta.anchors, result.code);
      this.lastGood = { text: result.code, mappings };
      this.stale = false;
      return { id: "ts", languageId: "typescript", snapshot: snapshotOf(result.code), mappings };
    }
    // Bailed (irrecoverable parse): serve last-good so the editor never goes
    // dark; diagnostics above already describe the current breakage.
    this.stale = true;
    if (this.lastGood) {
      return {
        id: "ts",
        languageId: "typescript",
        snapshot: snapshotOf(this.lastGood.text),
        mappings: withoutSemanticTokens(this.lastGood.mappings),
      };
    }
    // No last-good yet: raw source with a diagnostics-only whole-file mapping.
    return {
      id: "ts",
      languageId: "typescript",
      snapshot: snapshotOf(source),
      mappings: [{ sourceOffsets: [0], generatedOffsets: [0], lengths: [source.length], data: { verification: true } }],
    };
  }
}
