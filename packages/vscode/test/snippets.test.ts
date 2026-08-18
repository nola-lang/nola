import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseNola } from "@nola-lang/parser";
import { describe, expect, it } from "vitest";

// Snippets ship as a VS Code-native completion source, independent of the LSP.
// They live under `language/` on purpose: scripts/package.mjs stages exactly
// `language` and `media` into the VSIX, so a snippets file anywhere else would
// pass every unit test here and then silently not ship.

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));

interface SnippetContribution {
  language: string;
  path: string;
}

interface Snippet {
  prefix: string;
  body: string[];
  description?: string;
}

const manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const contributions: SnippetContribution[] = manifest.contributes?.snippets ?? [];

describe("snippet contributions", () => {
  it("registers a snippets file for the nola language", () => {
    expect(contributions).toEqual([{ language: "nola", path: "./language/nola.snippets.json" }]);
  });

  it("keeps every snippets file under language/, the only staged asset dir", () => {
    const staged = readFileSync(join(pkgDir, "scripts", "package.mjs"), "utf8");
    expect(staged).toMatch(/for \(const dir of \[[^\]]*"language"/);
    for (const { path } of contributions) {
      expect(path.startsWith("./language/")).toBe(true);
    }
  });
});

// `declaration` snippets stand alone at module level; `expression` snippets are
// meant to land on the right-hand side of an assignment, and `ask` is only
// legal inside an infer function — so each kind gets the context it is used in.
type Kind = "declaration" | "expression";

const EXPECTED: ReadonlyArray<{ name: string; prefix: string; kind: Kind }> = [
  { name: "Infer function", prefix: "infer", kind: "declaration" },
  { name: "Infer function with contextual parameter", prefix: "inferc", kind: "declaration" },
  { name: "Infer function with instruction", prefix: "inferi", kind: "declaration" },
  { name: "Ask (typed extractor)", prefix: "ask", kind: "expression" },
  { name: "Ask (free text)", prefix: "askfree", kind: "expression" },
  { name: "Ask with provider", prefix: "askwith", kind: "expression" },
  { name: "Call intent", prefix: "calli", kind: "expression" },
  { name: "Extractor", prefix: "extract", kind: "expression" },
];

/** Resolve `${1:default}` / `${2}` / `$0` tab stops down to the text they insert. */
function render(body: string[]): string {
  return body.join("\n").replace(/\$\{\d+:([^}]*)\}|\$\{\d+\}|\$\d+/g, (_, def) => def ?? "");
}

function asModule(rendered: string, kind: Kind): string {
  return kind === "declaration"
    ? rendered
    : `infer function __probe() {\n  const __value = ${rendered};\n}`;
}

describe("nola.snippets.json", () => {
  const snippets: Record<string, Snippet> = JSON.parse(
    readFileSync(join(pkgDir, "language", "nola.snippets.json"), "utf8"),
  );

  it("expands `infer` into an infer function declaration", () => {
    const snippet = snippets["Infer function"];
    expect(snippet.prefix).toBe("infer");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: VS Code snippet tab-stop syntax, not a JS template placeholder.
    expect(snippet.body.join("\n")).toBe("infer function ${1:name}(${2}) {\n\t$0\n}");
  });

  it("covers the Nola surface with one snippet per construct", () => {
    expect(Object.keys(snippets)).toEqual(EXPECTED.map((s) => s.name));
    for (const { name, prefix } of EXPECTED) {
      expect(snippets[name]?.prefix, name).toBe(prefix);
    }
  });

  it("gives every snippet a prefix, a description, and a body", () => {
    for (const [name, snippet] of Object.entries(snippets)) {
      expect(snippet.prefix, name).toBeTruthy();
      expect(snippet.description, name).toBeTruthy();
      expect(snippet.body.length, name).toBeGreaterThan(0);
    }
  });

  // The reason a snippet is worth testing at all: a stray backtick or a missing
  // `..` produces text that looks right in review and is a parse error the
  // moment a user accepts it. Parse what each snippet actually inserts.
  it.each(EXPECTED)("inserts parseable Nola for `$prefix`", ({ name, kind }) => {
    const snippet = snippets[name];
    const source = asModule(render(snippet.body), kind);
    const { ast, diagnostics } = parseNola(source, "snippet.tsi");
    expect(diagnostics, source).toEqual([]);
    expect(ast, source).not.toBeNull();
  });
});
