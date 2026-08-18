import type { Diagnostic } from "@nola-lang/ast";
import { codeFrame } from "./frame.js";

export function printDiagnostics(diagnostics: Diagnostic[], readSource: (file: string) => string | null): string {
  return diagnostics
    .map((d) => {
      const head = `${d.file}:${d.loc.start.line}:${d.loc.start.column + 1} ${d.code}: ${d.message}`;
      const source = readSource(d.file);
      return source ? `${head}\n${codeFrame(source, d.loc.start.line, d.loc.start.column)}` : head;
    })
    .join("\n\n");
}
