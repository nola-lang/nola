import { type BaseNode, Codes, type Diagnostic } from "@nola-lang/ast";
import { parse as babelParse } from "@nola-lang/babel-parser";

export interface ParseOptions {
  /**
   * Editor mode: enable Babel errorRecovery so a broken file still yields a
   * best-effort AST. Recovered errors surface in `diagnostics`; `ast` is null
   * only when even recovery could not proceed. Default (strict) is unchanged:
   * any error yields `ast: null`.
   */
  tolerant?: boolean;
}

export interface ParseResult {
  ast: BaseNode | null;
  diagnostics: Diagnostic[];
}

interface BabelSyntaxError {
  message?: string;
  loc?: { line: number; column: number };
  pos?: number;
}

const CODE_PREFIX = /^(NOLA\d{4}): /;

function toDiagnostic(e: BabelSyntaxError, source: string, file: string): Diagnostic {
  const raw = e.message ?? "parse error";
  const match = CODE_PREFIX.exec(raw);
  const line = e.loc?.line ?? 1;
  const column = e.loc?.column ?? 0;
  const start = e.pos ?? 0;
  return {
    code: match?.[1] ? match[1] : Codes.ParseError,
    message: match ? raw.slice(match[0].length) : raw,
    file,
    start,
    end: Math.min(start + 1, source.length),
    loc: { start: { line, column }, end: { line, column: column + 1 } },
  };
}

export function parseNola(source: string, file: string, options: ParseOptions = {}): ParseResult {
  try {
    const ast = babelParse(source, {
      sourceType: "module",
      plugins: [["typescript", {}], "nola"],
      attachComment: true,
      errorRecovery: options.tolerant === true,
    }) as BaseNode & { errors?: BabelSyntaxError[] };
    const diagnostics = (ast.errors ?? []).map((e) => toDiagnostic(e, source, file));
    return { ast, diagnostics };
  } catch (err) {
    return { ast: null, diagnostics: [toDiagnostic(err as BabelSyntaxError, source, file)] };
  }
}
