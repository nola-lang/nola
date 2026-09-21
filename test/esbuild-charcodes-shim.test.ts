// The vendored parser reads its character constants from `charcodes`, a
// CommonJS package. esbuild wraps a CommonJS module in getters (`__toESM`), so
// in every bundle we ship — the parser dist, the LSP server, the tsserver
// plugin, the Turbopack loader — each `charCodes.x` read in the tokenizer's
// inner loop became a function call: the bundled parser ran 2.5x slower than
// the same code unbundled (profiled 2026-09-20). The bundle scripts therefore
// alias `charcodes` to `scripts/esbuild/charcodes.js`, an ESM module of plain
// `export const` integers that esbuild inlines.
//
// Two things could go wrong with a shim, and this test holds both: a constant
// whose value drifts from the package (a silent mis-tokenization of a rare
// character), and a name the fork reads that the shim does not export (an
// `undefined` comparison — esbuild warns about it, and the bundle scripts fail
// on warnings, but the unbundled test runs would never see it).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as shim from "../scripts/esbuild/charcodes.js";

const require = createRequire(import.meta.url);
const pkg: Record<string, unknown> = require("charcodes");

const FORK_SRC = join(import.meta.dirname, "..", "packages", "babel-parser", "src");

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...tsFilesUnder(path));
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

describe("scripts/esbuild/charcodes.js (the bundles' stand-in for the charcodes package)", () => {
  it("exports every numeric constant of the installed package with the same value, and nothing else", () => {
    const numeric = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "number"));
    expect(numeric(shim as Record<string, unknown>)).toEqual(numeric(pkg));
    const extra = Object.keys(shim).filter((k) => !(k in pkg));
    expect(extra).toEqual([]);
  });

  it("agrees with the package on isDigit, its one function", () => {
    const isDigit = (pkg as { isDigit: (code: number) => boolean }).isDigit;
    for (let code = 0; code < 0x80; code++) expect(shim.isDigit(code)).toBe(isDigit(code));
  });

  it("exports every name the vendored parser reads through `charCodes.`", () => {
    const used = new Set<string>();
    for (const file of tsFilesUnder(FORK_SRC)) {
      for (const m of readFileSync(file, "utf8").matchAll(/\bcharCodes\.([A-Za-z0-9_]+)/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(50);
    const missing = [...used].filter((name) => !(name in shim));
    expect(missing).toEqual([]);
  });
});
