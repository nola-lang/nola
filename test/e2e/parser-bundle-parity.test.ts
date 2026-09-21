// The published parser (`packages/parser/dist/index.js`) is an esbuild bundle
// that aliases the fork's `charcodes` dependency to `scripts/esbuild/charcodes.js`
// (see test/esbuild-charcodes-shim.test.ts for why). Unit tests never see that
// bundle — vitest aliases `@nola-lang/parser` to `src`, which reads the real
// package — so this suite holds the two to each other: over every `.tsi` in
// the repo (strict) and the tolerant-mode recoveries the editor lives on, the
// bundle must produce the same AST and the same diagnostics, byte for byte.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseNola as parseFromSource } from "@nola-lang/parser";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureBuilt } from "./helpers/ensure-built.js";

const ROOT = join(import.meta.dirname, "..", "..");
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".nola", "comparisons"]);

function tsiFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...tsiFilesUnder(path));
    else if (entry.endsWith(".tsi")) out.push(path);
  }
  return out;
}

/** The half-typed states the tolerant parser recovers from (each is its own recovery path). */
const TOLERANT_SOURCES: Record<string, string> = {
  "dangling member access at EOF": "const person = ask `the person`<{ name: string }>;\nconsole.",
  "lone dot after ask": "infer function f() {\n  return ask .\n}\n",
  "nameless context parameter": "infer function f(.name: string, .) {\n  return ask `p`<string>;\n}\n",
  "missing expression at EOF": "const x =",
  "type args after a stray semicolon, mid-file": "const p = ask `p`;<{ name: string }>;\nconsole.log(p);\n",
  // (concatenated so biome does not read the `${` as a template placeholder)
  "scope access hole mid-typing": "infer function f(.name: string) {\n  return ask `hello $" + "{.}`<string>;\n}\n",
  "retired double-dot parameter": "infer function f(..name: string) {\n  return ask `p`<string>;\n}\n",
  "reserved var binding": "var .x = 1;\n",
  "unknown extractor kind": "infer function f() {\n  return ask ..foo`q`<string>;\n}\n",
};

type ParseNola = typeof parseFromSource;
let parseFromBundle: ParseNola;

beforeAll(async () => {
  await ensureBuilt(ROOT);
  const bundle = pathToFileURL(join(ROOT, "packages", "parser", "dist", "index.js")).href;
  parseFromBundle = ((await import(bundle)) as { parseNola: ParseNola }).parseNola;
}, 400_000);

const canonical = (result: ReturnType<ParseNola>) => JSON.stringify(result);

describe("the bundled parser parses exactly like the source parser", () => {
  const files = tsiFilesUnder(ROOT);

  it("has a corpus to compare", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const file of files) {
    it(`${basename(file)} (strict): ${file.slice(ROOT.length + 1)}`, () => {
      const source = readFileSync(file, "utf8");
      expect(canonical(parseFromBundle(source, file))).toBe(canonical(parseFromSource(source, file)));
    });
  }

  for (const [name, source] of Object.entries(TOLERANT_SOURCES)) {
    it(`${name} (tolerant)`, () => {
      const bundled = parseFromBundle(source, "editor.tsi", { tolerant: true });
      const fromSource = parseFromSource(source, "editor.tsi", { tolerant: true });
      expect(canonical(bundled)).toBe(canonical(fromSource));
      // the recovery produced something in both — a null AST on both sides would be a vacuous pass
      expect(bundled.ast).not.toBeNull();
    });
  }
});
