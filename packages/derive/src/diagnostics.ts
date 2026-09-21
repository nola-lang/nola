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
   * The generated (embedded) text the requests were computed on. Volar serves
   * a `.tsi` to TypeScript as a whitespace shadow of the SOURCE followed by
   * that text (decorateLanguageServiceHost, unless preventLeadingOffset), so
   * a request's `lowered` range sits `sourceFile.text.length - generatedText
   * .length` characters later in the program's SourceFile than in the
   * embedded code. Passing the text lets the pass VERIFY that the program is
   * at this version before it reads a single range: the requests and the
   * program are versioned independently (the virtual code updates on the
   * document, the program on its own sync), and a program one edit behind
   * turned the length difference into a shift that landed every range on the
   * wrong node — `<Perso` is spanned by the ExtractIntent call, typed
   * Askable<T>, and the walk failed on its first method. Reported positions
   * stay in embedded coordinates.
   */
  generatedText?: string;
  /** The raw shift, for a caller that has verified the program itself. Ignored when `generatedText` is given. */
  leadingOffset?: number;
}

/**
 * The editor's lazy derivation pass (spec §7): the virtual code is phase-1
 * output (inert accessors), so underivable types are found here, from the
 * LIVE language service's program, on each diagnostics pass. Exported-type
 * failures produce nothing — the value is typed `InferType` in the editor and
 * `nola check` reports the UnsupportedType — and a context site only reports
 * under the "error" policy, exactly as finalizeDerivations does.
 *
 * Returns `undefined` when `generatedText` is given and the program's
 * SourceFile does not end with it — the program is not at this version, and
 * nothing can be said about these requests from it. The caller keeps what it
 * last published; the next pass runs against the caught-up program.
 */
export function derivationDiagnostics(
  program: ts.Program,
  fileName: string,
  derivations: DerivationRequest[],
  options: EditorDerivationOptions,
): EditorDerivationDiagnostic[] | undefined {
  const sf = program.getSourceFile(fileName);
  if (!sf) return [];
  let leading: number;
  if (options.generatedText !== undefined) {
    if (!sf.text.endsWith(options.generatedText)) return undefined;
    leading = sf.text.length - options.generatedText.length;
  } else {
    leading = options.leadingOffset ?? 0;
  }
  if (derivations.length === 0) return [];
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
    // authoring errors (a dangling view import, a malformed constraint tag or decision
    // criteria) surface at a context site under every policy, as in finalizeDerivations
    const authoring = a.code === "NOLA2007" || a.code === "NOLA2012" || a.code === "NOLA2015";
    if (req.kind === "context" && req.policy !== "error" && !authoring) return;
    out.push({
      code: a.code ?? (req.kind === "extract" ? "NOLA2002" : "NOLA2008"),
      message: a.reason,
      generatedStart: req.lowered.start,
      generatedEnd: req.lowered.end,
    });
  });
  return out;
}
