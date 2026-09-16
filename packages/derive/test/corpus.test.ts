import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileNola, finalizeDerivations } from "@nola-lang/compiler";
import { afterAll, describe, expect, it } from "vitest";
import { createDerivationService, type DerivationService } from "../src/service.js";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const corpus = JSON.parse(readFileSync(join(ROOT, "test/derivation-corpus/type-exprs.json"), "utf8")) as Record<
  string,
  string[]
>;

/** nearest dir with nola.config.ts, else the file's dir — findProjectRoot without a node-loader dependency */
function projectRootOf(file: string): string {
  let dir = dirname(file);
  for (;;) {
    if (existsSync(join(dir, "nola.config.ts"))) return dir;
    const up = dirname(dir);
    if (up === dir) return dirname(file);
    dir = up;
  }
}

/** Every OUTERMOST `__nola.types.<name>(…)` expression (with a `.describe()` chain), as the recorder scans them. */
function extractTypeExprs(code: string): string[] {
  const out: string[] = [];
  const START = "__nola.types.";
  let i = 0;
  while (true) {
    i = code.indexOf(START, i);
    if (i === -1) break;
    const open = code.indexOf("(", i);
    if (open === -1) break;
    let end = balancedEnd(code, open);
    while (code.startsWith(".describe(", end)) end = balancedEnd(code, end + ".describe".length);
    out.push(code.slice(i, end));
    i = end;
  }
  return out;
}

function balancedEnd(code: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let j = open; j < code.length; j++) {
    const ch = code[j] as string;
    if (quote) {
      if (ch === "\\") j++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  throw new Error("unbalanced combinator expression");
}

const services = new Map<string, DerivationService>();
afterAll(() => {
  for (const s of services.values()) s.dispose();
});

// The fingerprint invariant, mechanically: for every .tsi the syntactic walker
// ever derived, the checker walk must produce the same multiset of combinator
// expressions — byte for byte. A difference here is a bug in the WALK.
describe("checker walk reproduces the syntactic corpus", () => {
  it.each(Object.entries(corpus).filter(([rel]) => existsSync(resolve(ROOT, rel))))("%s", (rel, expected) => {
    const file = resolve(ROOT, rel);
    const root = projectRootOf(file);
    let svc = services.get(root);
    if (!svc) {
      svc = createDerivationService({ projectRoot: root, sourceRoot: root, underivableContextType: "error" });
      services.set(root, svc);
    }
    const p1 = compileNola(readFileSync(file, "utf8"), file, { sourceRoot: root });
    expect(p1.diagnostics).toEqual([]);
    const done = finalizeDerivations(p1, svc.derive(file, p1).answers, file);
    expect(done.diagnostics).toEqual([]);
    expect(extractTypeExprs(done.code).sort()).toEqual(expected);
  });
});
