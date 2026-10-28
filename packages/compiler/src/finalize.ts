import { Codes, type Diagnostic } from "@nola-lang/ast";
import { accessorDecl, toolAccessorDecl, unsupportedAccessorDeclFor, viewImportDecl } from "./lower/templates.js";
import { accessorNameFor } from "./schema-expr.js";
import { toolNameCollisions } from "./tool-names.js";
import type { CompileResult, DerivationAnswer, DerivationRequest, NamedAccessor } from "./types.js";
import type { ViewResult } from "./view.js";
import { viewSpecifierFor } from "./view-name.js";

/**
 * Phase 2 of the two-phase compile (checker-backed derivation, emit 15):
 * rewrite the appendix tail from `appendixStart` — the inert accessor bodies
 * become the answered combinator expressions, `ok: false` exported accessors
 * become `UnsupportedType<reason>` accessors, context accessors under "omit"
 * return undefined, transitively reached named accessors are emitted once,
 * and the `.tsi` value imports the answers reached are appended. The body is
 * never touched: the exported value's `TypeValueOf` cast already reads the
 * accessor's return type. The appendix is unmapped, so spans, the source map
 * and the anchors stay valid; only the appendix span grows.
 */
export function finalizeDerivations<T extends CompileResult | ViewResult>(
  result: T,
  answers: DerivationAnswer[],
  file = "<unknown>",
): T {
  const derivations = "meta" in result ? result.meta.derivations : result.derivations;
  const appendixStart = "meta" in result ? result.meta.appendixStart : result.appendixStart;
  if (appendixStart < 0 || derivations.length === 0) return result;

  // the names a tool list's entries declare are checked for collisions per ask (spec 2026-10-09 §3.4) — the same pass the editor runs
  const byAccessor = new Map(toolNameCollisions(derivations, answers).map((a) => [a.accessor, a]));
  const named = new Map<string, NamedAccessor>();
  const imports = new Map<string, { specifier: string; importedName: string }>();
  const diagnostics: Diagnostic[] = [...result.diagnostics];
  let out = "";

  for (const req of derivations) {
    const a = byAccessor.get(req.accessor);
    if (!a) throw new Error(`finalizeDerivations: no answer for ${req.accessor} (${file})`);
    for (const acc of a.accessors) if (!named.has(acc.name)) named.set(acc.name, acc);
    if (a.ok) {
      for (const imp of a.imports) imports.set(imp.localBinding, imp);
      out +=
        req.kind === "tool"
          ? toolAccessorDecl(req.accessor, a.expr)
          : accessorDecl(req.accessor, a.expr, req.kind === "context" || req.kind === "value");
      continue;
    }
    if (
      a.code === Codes.ViewUnavailable ||
      a.code === Codes.InvalidConstraint ||
      a.code === Codes.InvalidDecisionCriteria ||
      a.code === Codes.ToolEntryInvalid
    ) {
      // a dangling `.tsi` view import (the module the type lives in does not
      // exist), a malformed JSDoc constraint tag, malformed decision criteria
      // (NOLA2015) or a tool list entry that is not callable (NOLA2018) is an
      // error at every kind of site — an authoring mistake, never a policy
      // question
      diagnostics.push(diag(a.code, a.reason, req, file));
      out += fallbackAccessorDecl(req);
      continue;
    }
    switch (req.kind) {
      case "exported":
        out += unsupportedAccessorDeclFor(req.accessor, a.reason);
        break;
      case "extract":
      case "tool":
        // an underivable answer type, or an underivable tool parameter: the
        // contract fails at the site (never a policy question)
        diagnostics.push(diag(Codes.UnsupportedIntentType, a.reason, req, file));
        // keep the module evaluable; the diagnostic fails the build
        out += fallbackAccessorDecl(req);
        break;
      case "context":
        if (req.policy === "error") {
          diagnostics.push(
            diag(
              Codes.UnderivableContextType,
              `contextual parameter has a type that cannot be derived for inference: ${a.reason}. ` +
                `Set compiler.underivableContextType to "prune" or "omit" in nola.config.ts to allow it.`,
              req,
              file,
            ),
          );
        }
        out += accessorDecl(req.accessor, "undefined", true);
        break;
      case "value":
        // a bare value's type is a courtesy to the model (spec 2026-10-12 §3.5): underivable → undefined, never a diagnostic
        out += accessorDecl(req.accessor, "undefined", true);
        break;
    }
  }
  // a named type that is ALSO an exported request already has its accessor above
  const requested = new Set(derivations.map((d) => d.accessor));
  for (const acc of named.values()) {
    if (requested.has(accessorNameFor(acc.name))) continue;
    out +=
      "expr" in acc
        ? accessorDecl(accessorNameFor(acc.name), acc.expr)
        : unsupportedAccessorDeclFor(accessorNameFor(acc.name), acc.unsupported);
  }
  for (const [local, imp] of imports) out += viewImportDecl(local, imp);

  const code = result.code.slice(0, appendixStart) + out;
  const views = [...new Set([...imports.values()].map((i) => viewSpecifierFor(i.specifier)))].sort();

  if ("meta" in result) {
    const spans = result.meta.spans.map((s) => ({ ...s }));
    const last = spans[spans.length - 1];
    if (last?.kind === "appendix") last.generatedEnd = code.length;
    return { ...result, code, diagnostics, meta: { ...result.meta, views, spans } };
  }
  return { ...result, code, diagnostics, views };
}

function diag(code: string, message: string, req: DerivationRequest, file: string): Diagnostic {
  return { code, message, file, start: req.source.start, end: req.source.end, loc: req.source.loc };
}

/** The evaluable body a failed request's accessor keeps: the diagnostic fails the build, the module still loads. */
function fallbackAccessorDecl(req: DerivationRequest): string {
  if (req.kind === "context" || req.kind === "value") return accessorDecl(req.accessor, "undefined", true);
  if (req.kind === "tool") return toolAccessorDecl(req.accessor, req.tool?.spread ? "__nola.tools.tuple([])" : "__nola.types.object({})");
  return accessorDecl(req.accessor, "__nola.types.string()");
}
