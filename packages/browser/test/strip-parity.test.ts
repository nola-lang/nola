import { readdirSync, readFileSync, statSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripLowered } from "@nola-lang/browser";
import { compileNola } from "@nola-lang/compiler";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { finalizeOnNode } from "./helpers/finalize-on-node.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));

/** Every `.tsi` under the examples' `src` directories: the programs a user actually writes. */
function exampleSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".tsi")) out.push(p);
    }
  };
  for (const example of readdirSync(join(root, "examples"))) {
    const src = join(root, "examples", example, "src");
    try {
      if (statSync(src).isDirectory()) walk(src);
    } catch {
      // an example without src/
    }
  }
  return out.sort();
}

/** Node's strip mode keeps a `;` where a blanked statement ended; the blanker blanks it. Layout is what matters. */
const normalize = (s: string) =>
  s
    .replace(/;/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n");

const files = exampleSources();

describe("stripLowered keeps Node's strip-mode layout (layout mode)", () => {
  it("found the example programs", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)("%s", (file) => {
    const source = readFileSync(file, "utf8");
    const phase1 = compileNola(source, file, { sourceRoot: root });
    expect(phase1.diagnostics).toEqual([]);
    // The phase-1 lowering (inert accessors) always; the finalized one too when the throwaway
    // program can answer every request (a cross-file type or a policy error needs the full
    // derivation service, which is not what is under test here).
    const finalized = finalizeOnNode(phase1, file);
    const candidates = finalized.diagnostics.length === 0 ? [phase1, finalized] : [phase1];
    for (const lowered of candidates) {
      const ours = stripLowered(ts, lowered, { sourceUrl: "nola://x.tsi" });
      let node: string;
      try {
        node = stripTypeScriptTypes(lowered.code, { mode: "strip" });
      } catch (error) {
        // non-erasable syntax (classify-message has an enum): Node falls back to transform mode and so do we
        expect((error as { code?: string }).code).toBe("ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX");
        expect(ours.mode).toBe("transform");
        continue;
      }
      expect(ours.mode).toBe("layout");
      expect(ours.code.split("\n").length).toBe(node.split("\n").length);
      expect(normalize(ours.code)).toBe(normalize(node));
      const map = JSON.parse(ours.map) as { sources: string[]; sourcesContent?: string[] };
      expect(map.sources).toEqual(["nola://x.tsi"]);
      expect(map.sourcesContent?.[0]).toBe(source);
    }
  });
});
