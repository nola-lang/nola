import { readFileSync } from "node:fs";
import type { Diagnostic } from "@nola-lang/ast";
import { compileNola, finalizeDerivations } from "@nola-lang/compiler";
import type { ProjectContext } from "./project.js";
import { wiringIdFor } from "./wiring.js";

/** Every diagnostic on one line each — Bun prints the thrown error and the import fails (the strict path, never tolerant). */
export function diagnosticsError(diagnostics: readonly Diagnostic[]): Error {
  return new Error(diagnostics.map((d) => `${d.file}: ${d.code}: ${d.message}`).join("\n"));
}

/**
 * Phase 1 → the checker → phase 2: the lowered TypeScript Bun strips itself. `wire`
 * appends the bundle-mode config import at EOF — unmapped, original positions intact,
 * exactly as unplugin's transformTsi and `nola build`'s dist import.
 */
export function lowerTsi(file: string, ctx: ProjectContext, wire: boolean): string {
  // bun --hot re-loads a changed .tsi in the same process: its own text re-derives
  ctx.service.invalidate(file);
  const source = readFileSync(file, "utf8");
  const phase1 = compileNola(source, file, { sourceRoot: ctx.root, underivableContextType: ctx.underivableContextType });
  if (phase1.diagnostics.length > 0) throw diagnosticsError(phase1.diagnostics);
  const { answers } = ctx.service.derive(file, phase1);
  const lowered = finalizeDerivations(phase1, answers, file);
  if (lowered.diagnostics.length > 0) throw diagnosticsError(lowered.diagnostics);
  if (!wire || ctx.configPath === null) return lowered.code;
  return `${lowered.code}\nimport ${JSON.stringify(wiringIdFor(ctx.configPath))};\n`;
}
