import type { DerivationAnswer, DerivationRequest } from "@nola-lang/compiler";
import type ts from "typescript";
import { TS } from "./ts.js";
import { DerivationError, deriveType, type WalkContext } from "./walk.js";

export interface AnswerContext {
  /** absolute path of the file whose appendix the answers land in (the .tsi, or the viewed plain file) */
  importerFile: string;
  /** posix, project-relative display path of that file */
  importerDisplayFile: string;
  sourceRoot: string;
  /** Turbopack inline mode: accessor naming override */
  accessorName?: (local: string) => string;
}

/**
 * Answer a phase-1 result's requests against a program that holds its lowered
 * text under `sf`: each request's `lowered` range names the type node the
 * checker reads. Shared by the DerivationService (loader, bundlers), the
 * tshost program (`nola build` / `nola check`) and the editor's lazy
 * diagnostics — one walk, one answer per type everywhere.
 */
export function answerRequests(
  program: ts.Program,
  sf: ts.SourceFile,
  requests: DerivationRequest[],
  ctx: AnswerContext,
): DerivationAnswer[] {
  const checker = program.getTypeChecker();
  return requests.map((req) => {
    const node = nodeAt(sf, req.lowered.start, req.lowered.end);
    const walkCtx: WalkContext = {
      checker,
      importerFile: ctx.importerFile,
      importerDisplayFile: ctx.importerDisplayFile,
      sourceRoot: ctx.sourceRoot,
      lossy: req.policy === "prune",
      ...(ctx.accessorName ? { accessorName: ctx.accessorName } : {}),
    };
    try {
      const out = deriveType(node, walkCtx, req.kind === "exported" ? req.name : undefined);
      return { accessor: req.accessor, ok: true, expr: out.expr, accessors: out.accessors, imports: out.imports, deps: out.deps };
    } catch (e) {
      if (!(e instanceof DerivationError)) throw e;
      return { accessor: req.accessor, ok: false, reason: e.message, ...(e.code ? { code: e.code } : {}), accessors: [], deps: [] };
    }
  });
}

/** The smallest node spanning exactly [start, end): a TypeNode for site/context requests, the name Identifier for exported ones. */
export function nodeAt(sf: ts.SourceFile, start: number, end: number): ts.Node {
  let best: ts.Node = sf;
  const visit = (n: ts.Node): void => {
    if (n.getStart(sf) <= start && n.getEnd() >= end) {
      best = n;
      TS.forEachChild(n, visit);
    }
  };
  TS.forEachChild(sf, visit);
  if (best === sf) {
    throw new Error(
      `derive: no node spans [${start}, ${end}) in ${sf.fileName} — text there is ${JSON.stringify(sf.text.slice(start, end))} (file length ${sf.text.length})`,
    );
  }
  return best;
}
