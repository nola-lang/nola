// Records every top-level `__nola.types.…` combinator expression the SYNTACTIC
// walker emitted for each `.tsi` under examples/ and the e2e fixtures — named
// accessor bodies AND the inline expressions at extract sites and in wrapper
// args. Run ONCE before the walker was deleted (checker-backed derivation
// plan, Task 4); packages/derive's corpus test replays it and demands the
// same sorted multiset from the checker walk — the fingerprint invariant,
// mechanically. Re-run only if a fixture changes AND the change is meant to
// alter its schema.
//
//   npm run build && node scripts/record-derivation-corpus.mjs
import { globSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { compileNola } from "../packages/compiler/dist/index.js";
import { findProjectRoot } from "../packages/node-loader/dist/config.js";

/**
 * Every OUTERMOST `__nola.types.<name>(…)` expression in `code`, in text
 * order, including a trailing `.describe("…")` chain. Balanced-paren scan;
 * string literals inside are skipped so a `)` in a description cannot end
 * the expression early.
 */
export function extractTypeExprs(code) {
  const out = [];
  const START = "__nola.types.";
  let i = 0;
  while ((i = code.indexOf(START, i)) !== -1) {
    const open = code.indexOf("(", i);
    if (open === -1) break;
    let end = balancedEnd(code, open);
    for (;;) {
      const chain = code.slice(end, end + 10);
      if (!chain.startsWith(".describe(")) break;
      end = balancedEnd(code, end + 9);
    }
    out.push(code.slice(i, end));
    i = end;
  }
  return out;
}

/** Index just past the `)` matching the `(` at `open`. */
function balancedEnd(code, open) {
  let depth = 0;
  let quote = null;
  for (let j = open; j < code.length; j++) {
    const ch = code[j];
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

const ROOT = process.cwd();
const files = globSync(["examples/*/src/**/*.tsi", "test/e2e/fixtures/**/*.tsi"], { cwd: ROOT })
  .map((f) => f.replace(/\\/g, "/"))
  .filter((f) => !/node_modules|\/dist\/|\.next/.test(f))
  .sort();

const corpus = {};
let total = 0;
for (const rel of files) {
  const file = resolve(ROOT, rel);
  const { code, diagnostics } = compileNola(readFileSync(file, "utf8"), file, {
    sourceRoot: findProjectRoot(dirname(file)),
  });
  if (diagnostics.length > 0) continue;
  const exprs = extractTypeExprs(code).sort();
  corpus[rel] = exprs;
  total += exprs.length;
}

mkdirSync(resolve(ROOT, "test/derivation-corpus"), { recursive: true });
writeFileSync(resolve(ROOT, "test/derivation-corpus/type-exprs.json"), `${JSON.stringify(corpus, null, 2)}\n`);
console.log(`${files.length} files, ${total} combinator expressions`);
