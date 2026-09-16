import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Codes } from "@nola-lang/ast";
import { viewSourceCandidates } from "@nola-lang/compiler";

/**
 * NOLA2007 for every generated `.tsi` import of a lowered file that names
 * neither a Nola file nor a plain TypeScript module next to the importer —
 * the same probe the loader, the bundler plugins and tshost perform.
 */
export function danglingViewErrors(importer: string, views: string[]): string[] {
  const out: string[] = [];
  for (const spec of views) {
    const target = resolve(dirname(importer), spec);
    if (existsSync(target) || viewSourceCandidates(target).some((c) => existsSync(c))) continue;
    out.push(`${importer} ${Codes.ViewUnavailable}: "${spec}" names neither a Nola file nor a TypeScript module`);
  }
  return out;
}
