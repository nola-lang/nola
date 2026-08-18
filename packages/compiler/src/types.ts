import type { Diagnostic } from "@nola-lang/ast";
import type { UnderivableContextTypeMode } from "@nola-lang/core";
import type { SourceMap } from "magic-string";
import type { Anchor, Span } from "./spans.js";

export interface CompileResult {
  code: string;
  map: SourceMap;
  meta: {
    nolaFunctions: string[];
    spans: Span[];
    /** verbatim-copied fragments inside replaced spans (full-feature editor mappings) */
    anchors: Anchor[];
    companions: string[];
    mode: "lowered" | "bailed";
  };
  diagnostics: Diagnostic[];
}

export interface CompileOptions {
  /** Project root; when set, emitted paths are made relative to it. */
  sourceRoot?: string;
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
