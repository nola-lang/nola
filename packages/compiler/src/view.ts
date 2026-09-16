import type { BaseNode, Diagnostic } from "@nola-lang/ast";
import { NOLA_EMIT } from "@nola-lang/core";
import { parseNola } from "@nola-lang/parser";
import { inertAccessorDecl, typeValueText } from "./lower/templates.js";
import { displayPathFor } from "./path.js";
import { collectExportedTypeNames } from "./schema.js";
import { accessorNameFor } from "./schema-expr.js";
import type { CompileOptions, DerivationRequest } from "./types.js";
import { viewSourceSpecifierFor } from "./view-name.js";

export interface ViewResult {
  /** a TS module; "" when the source could not be parsed at all */
  code: string;
  /** `.tsi` specifiers THIS view imports (transitive worklist fuel), relative to the source file; filled by finalizeDerivations */
  views: string[];
  diagnostics: Diagnostic[];
  /** phase 1: one "exported" request per alias/interface */
  derivations: DerivationRequest[];
  /** offset of the inert accessor block; -1 when nothing derives */
  appendixStart: number;
}

export interface ViewOptions extends CompileOptions {
  /** what `export *` / `import(...)` name the source by; default `./<base>.js` (bundlers pass an absolute path) */
  sourceSpecifier?: string;
}

/**
 * Phase 1 of the VIEW of a plain TypeScript module (spec §2): what `./models.tsi`
 * means when no `models.tsi` exists. `export *` keeps one module instance for
 * the runtime values; every exported alias/interface is redeclared locally
 * (`export type X = import("./models.js").X`) — the only shape on which the
 * type meaning survives next to the value export (spike-verified on TS 5.9,
 * 6.0, 7.1) — and exported as a value. The accessor bodies are inert here;
 * the checker fills them in through finalizeDerivations, exactly as for a
 * lowered `.tsi`. Pure: hosts do all I/O and probing.
 */
export function compileView(source: string, file: string, options: ViewOptions = {}): ViewResult {
  const { ast, diagnostics } = parseNola(source, file, { tolerant: true });
  if (!ast) return { code: "", views: [], diagnostics, derivations: [], appendixStart: -1 };

  const spec = options.sourceSpecifier ?? viewSourceSpecifierFor(file);
  const isDts = /\.d\.ts$/.test(file);
  const exported = collectExportedTypeNames(ast).filter((d) => d.kind !== "enum");
  // displayPathFor keeps the same project-relative naming as the lowered .tsi;
  // the walk qualifies refs by declaration file, so no qualifier is needed here.
  void displayPathFor(file, options.sourceRoot);

  const lines: string[] = [];
  if (!isDts) lines.push(`export * from ${JSON.stringify(spec)};`);
  const typeLineIndex = new Map<string, number>();
  for (const d of exported) {
    typeLineIndex.set(d.name, lines.length);
    lines.push(`export type ${d.name} = import(${JSON.stringify(spec)}).${d.name};`);
  }
  lines.push(`import { __nola } from "@nola-lang/runtime";`, `__nola.useRuntime(${NOLA_EMIT});`);
  for (const d of exported) {
    lines.push(`export const ${d.name} = ${accessorNameFor(d.name)}() as unknown as ${typeValueText(d.name)};`);
  }
  const head = `${lines.join("\n")}\n`;
  const appendixStart = exported.length > 0 ? head.length : -1;

  let code = head;
  const derivations: DerivationRequest[] = [];
  for (const d of exported) {
    code += inertAccessorDecl(accessorNameFor(d.name));
    const id = ((d.node as { id?: BaseNode }).id ?? d.node) as BaseNode;
    // the redeclared `export type X = …` line: the checker reads X there
    const lineStart = lines.slice(0, typeLineIndex.get(d.name) as number).reduce((n, l) => n + l.length + 1, 0);
    const nameStart = lineStart + "export type ".length;
    derivations.push({
      accessor: accessorNameFor(d.name),
      kind: "exported",
      name: d.name,
      source: { start: id.start, end: id.end, loc: id.loc },
      lowered: { start: nameStart, end: nameStart + d.name.length },
    });
  }
  return { code, views: [], diagnostics, derivations, appendixStart };
}
