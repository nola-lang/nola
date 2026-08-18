import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Codes } from "@nola-lang/ast";
import { companionSourceCandidates, compileCompanion } from "@nola-lang/compiler";

export interface CompanionEntries {
  /** normalized absolute virtual path (<resolved companion>.ts) -> generated TS */
  virtual: Map<string, string>;
  /** virtual path -> on-disk source file it derives from (for diagnostic remap) */
  sources: Map<string, string>;
  errors: string[];
}

function norm(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Host-side worklist: resolve every companion specifier reachable from the
 * lowered entries (transitively through generated companions), generate each
 * module once, and key it under the exact virtual path TypeScript's NodeNext
 * `.js`→`.ts` mapping will look up.
 */
export async function collectCompanionEntries(
  seeds: Array<{ file: string; companions: string[] }>,
  sourceRoot: string,
): Promise<CompanionEntries> {
  const out: CompanionEntries = { virtual: new Map(), sources: new Map(), errors: [] };
  const queue = seeds.flatMap((s) => s.companions.map((c) => ({ importer: s.file, specifier: c })));
  const seen = new Set<string>();
  while (queue.length > 0) {
    const { importer, specifier } = queue.shift() as { importer: string; specifier: string };
    const resolved = resolve(dirname(importer), specifier); // …/models.nola.js
    const virtualName = `${norm(resolved).slice(0, -".js".length)}.ts`;
    if (seen.has(virtualName)) continue;
    seen.add(virtualName);
    const src = companionSourceCandidates(specifier)
      .map((c) => resolve(dirname(importer), c))
      .find((p) => existsSync(p));
    if (!src) {
      out.errors.push(`${importer} ${Codes.CompanionUnavailable}: cannot locate the type source for "${specifier}"`);
      continue;
    }
    const compiled = compileCompanion(await readFile(src, "utf8"), src, { sourceRoot });
    if (compiled.code === "" || compiled.diagnostics.length > 0) {
      out.errors.push(
        `${src} ${Codes.CompanionUnavailable}: cannot derive a type module (${compiled.diagnostics[0]?.message ?? "parse failed"})`,
      );
      continue;
    }
    out.virtual.set(virtualName, compiled.code);
    out.sources.set(virtualName, src);
    queue.push(...compiled.companions.map((c) => ({ importer: src, specifier: c })));
  }
  return out;
}
