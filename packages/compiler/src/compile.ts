import type { BaseNode } from "@nola-lang/ast";
import { parseNola } from "@nola-lang/parser";

import { lower } from "./lower/index.js";
import { displayPathFor } from "./path.js";
import type { CompileOptions, CompileResult } from "./types.js";

export function compileNola(source: string, file: string, options: CompileOptions = {}): CompileResult {
  const { ast, diagnostics } = parseNola(source, file, { tolerant: options.tolerant });
  if (!ast) {
    return {
      code: source,
      map: { mappings: "", sources: [file] } as CompileResult["map"],
      meta: {
        nolaFunctions: [],
        spans: [
          {
            sourceStart: 0,
            sourceEnd: source.length,
            generatedStart: 0,
            generatedEnd: source.length,
            kind: "verbatim",
          },
        ],
        anchors: [],
        companions: [],
        mode: "bailed",
      },
      diagnostics,
    };
  }
  const result = lower(source, file, ast as BaseNode, displayPathFor(file, options.sourceRoot), {
    underivableContextType: options.underivableContextType,
  });
  return { ...result, diagnostics: [...diagnostics, ...result.diagnostics] };
}
