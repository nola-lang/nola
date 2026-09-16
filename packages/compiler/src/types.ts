import type { Diagnostic } from "@nola-lang/ast";
import type { UnderivableContextTypeMode } from "@nola-lang/core";
import type { SourceMap } from "magic-string";
import type { Anchor, Span } from "./spans.js";

/**
 * Phase 1 → phase 2 handshake (checker-backed derivation, emit 15): one request
 * per accessor the appendix declares with an inert body. `lowered` is where the
 * SAME type node sits in the lowered text — that is where the checker reads it.
 */
export interface DerivationRequest {
  /** the accessor the appendix declares: `__nola_type_<Name>` or a site accessor `__nola_type_$N` */
  accessor: string;
  kind: "exported" | "extract" | "context";
  /** the declared name for kind "exported" */
  name?: string;
  /** the type node in the .tsi source (diagnostic anchor) */
  source: { start: number; end: number; loc: Diagnostic["loc"] };
  /** the same type node in the lowered text */
  lowered: { start: number; end: number };
  /** kind "context" only: compiler.underivableContextType ("omit" for plain params) */
  policy?: UnderivableContextTypeMode;
}

/** A `.tsi` value import an answer reached: `import { <importedName> as __nola_type_<localBinding> } from "<specifier>"`. */
export interface ViewImport {
  specifier: string;
  importedName: string;
  localBinding: string;
}

/** A named type an answer reached transitively (`Person` needs `Address`); emitted once per file. */
export type NamedAccessor = { name: string; expr: string } | { name: string; unsupported: string };

export type DerivationAnswer =
  | { accessor: string; ok: true; expr: string; accessors: NamedAccessor[]; imports: ViewImport[]; deps: string[] }
  | {
      accessor: string;
      ok: false;
      reason: string;
      /** a specific diagnostic code when the failure is not "underivable" (NOLA2007: a dangling `.tsi` view import) */
      code?: string;
      accessors: NamedAccessor[];
      deps: string[];
    };

export interface CompileResult {
  code: string;
  map: SourceMap;
  meta: {
    nolaFunctions: string[];
    spans: Span[];
    /** verbatim-copied fragments inside replaced spans (full-feature editor mappings) */
    anchors: Anchor[];
    /** `.tsi` specifiers the lowered module imports type values from (relative to this file); filled by finalizeDerivations */
    views: string[];
    mode: "lowered" | "bailed";
    /** phase 1: the accessors the checker must fill in (empty when nothing derives) */
    derivations: DerivationRequest[];
    /** generated offset where the inert accessor block begins; -1 without an appendix */
    appendixStart: number;
  };
  diagnostics: Diagnostic[];
}

/**
 * Bundlers without virtual modules (Turbopack): resolve a generated `.tsi`
 * import to its plain-TS source so the lowerer inlines the view's accessors
 * into the appendix. `null` keeps the import (a real `.tsi`, or a miss the
 * bundler will report).
 */
export interface ViewInlineOptions {
  inline: (specifier: string, importerFile: string) => { file: string; source: string } | null;
}

export interface CompileOptions {
  /** Project root; when set, emitted paths are made relative to it. */
  sourceRoot?: string;
  /**
   * Turbopack-only: inline views instead of importing `./x.tsi`. Never set by
   * the loader, `nola build/check` or the editor — those resolve views.
   */
  views?: ViewInlineOptions;
  /**
   * Editor mode: parse with error recovery and lower every intact construct.
   * Broken constructs keep their original bytes; parse diagnostics precede
   * lowering diagnostics in the result. Default (strict) bails to source on
   * any parse error, exactly as before.
   */
  tolerant?: boolean;
  /**
   * Policy when a `.`-contextual parameter's type cannot be derived into an
   * intent schema (`compiler.underivableContextType` in nola.config.ts):
   * "error" diagnoses NOLA2008, "prune" drops just the underivable members,
   * "omit" drops the whole type silently. Default: "error". Plain (non-`.`)
   * params are exempt in every mode — their type never describes a live value.
   */
  underivableContextType?: UnderivableContextTypeMode;
}
