import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { capture, ensureBuilt } from "./helpers/ensure-built.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PARSER_DIST = join(ROOT, "packages", "parser", "dist", "index.js");

// The vendored @nola-lang/babel-parser is never published — the built parser
// dist must be self-contained: the fork is inlined at bundle time and only
// published packages may remain as imports.
describe("parser dist bundle", () => {
  beforeAll(async () => {
    await ensureBuilt(ROOT);
  }, 600_000);

  it("does not import the private vendored parser", () => {
    const dist = readFileSync(PARSER_DIST, "utf8");
    expect(dist).not.toContain("@nola-lang/babel-parser");
  });

  it("parses an infer function from the built dist", async () => {
    // Subprocess with plain node resolution — vitest's src aliases must not
    // paper over a broken bundle.
    const code = [
      `const { parseNola } = await import(${JSON.stringify(pathToFileURL(PARSER_DIST).href)});`,
      `const src = 'infer function greet(.name: string) {\\n  return ask ..\`greeting for the user\`<string>;\\n}\\n';`,
      `const { ast, diagnostics } = parseNola(src, "greet.tsi");`,
      `console.log(JSON.stringify({ hasAst: ast !== null, diagnostics }));`,
    ].join("\n");
    const out = await capture(process.execPath, ["--input-type=module", "-e", code]);
    expect(JSON.parse(out)).toEqual({ hasAst: true, diagnostics: [] });
  });
});
