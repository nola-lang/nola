import { type DerivationRequest, displayPathFor } from "@nola-lang/compiler";
import type ts from "typescript";
import { answerRequests } from "./answer.js";

export interface EditorDerivationDiagnostic {
  /** NOLA2002 (extractor type), NOLA2008 (contextual parameter under "error") or NOLA2007 (dangling view import) */
  code: string;
  message: string;
  /** offsets in the GENERATED (embedded) text — the editor hosts map them back to the .tsi */
  generatedStart: number;
  generatedEnd: number;
}

export interface EditorDerivationOptions {
  sourceRoot: string;
  /**
   * Volar serves a `.tsi` to TypeScript as a whitespace shadow of the SOURCE
   * followed by the generated text (decorateLanguageServiceHost, unless
   * preventLeadingOffset), so a request's `lowered` range sits this many
   * characters later in the program's SourceFile than in the embedded code:
   * `sourceFile.text.length - embeddedText.length`. Reported positions stay
   * in embedded coordinates.
   */
  leadingOffset?: number;
}

/**
 * The editor's lazy derivation pass (spec §7): the virtual code is phase-1
 * output (inert accessors), so underivable types are found here, from the
 * LIVE language service's program, on each diagnostics pass. Exported-type
 * failures produce nothing — the value is typed `InferType` in the editor and
 * `nola check` reports the UnsupportedType — and a context site only reports
 * under the "error" policy, exactly as finalizeDerivations does.
 */
export function derivationDiagnostics(
  program: ts.Program,
  fileName: string,
  derivations: DerivationRequest[],
  options: EditorDerivationOptions,
): EditorDerivationDiagnostic[] {
  const sf = program.getSourceFile(fileName);
  if (!sf || derivations.length === 0) return [];
  const leading = options.leadingOffset ?? 0;
  const shifted = derivations.map((req) => ({
    ...req,
    lowered: { start: req.lowered.start + leading, end: req.lowered.end + leading },
  }));
  const answers = answerRequests(program, sf, shifted, {
    importerFile: fileName,
    importerDisplayFile: displayPathFor(fileName, options.sourceRoot),
    sourceRoot: options.sourceRoot,
  });
  const out: EditorDerivationDiagnostic[] = [];
  answers.forEach((a, i) => {
    const req = derivations[i];
    if (a.ok || !req || req.kind === "exported") return;
    if (req.kind === "context" && req.policy !== "error" && a.code !== "NOLA2007") return;
    out.push({
      code: a.code ?? (req.kind === "extract" ? "NOLA2002" : "NOLA2008"),
      message: a.reason,
      generatedStart: req.lowered.start,
      generatedEnd: req.lowered.end,
    });
  });
  return out;
}
