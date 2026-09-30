import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderPrompt } from "@nola-lang/core";
import { describe, expect, it } from "vitest";
import { fixtures } from "../packages/core/test/prompt-fixtures.js";

const PAGE = fileURLToPath(new URL("../docs-site/language/prompt.mdx", import.meta.url));

/**
 * Every ```txt fence on the page preceded by an MDX comment `{/* fixture: <name> *\/}`
 * (invisible when rendered — the marker must never be printed as part of a prompt), keyed by that name.
 */
function fencesByFixture(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /\{\/\* fixture: ([a-zA-Z]+) \*\/\}\n\n```txt\n([\s\S]*?)\n```/g;
  for (let m = re.exec(text); m; m = re.exec(text)) out.set(m[1] as string, m[2] as string);
  return out;
}

describe("the fixture markers never appear inside a rendered fence", () => {
  it("no ```txt fence starts with an HTML comment", () => {
    expect(readFileSync(PAGE, "utf8")).not.toMatch(/```txt\n<!--/);
  });
});

describe("docs-site/language/prompt.mdx is the rendered prompt", () => {
  const fences = fencesByFixture(readFileSync(PAGE, "utf8"));
  it("shows one fenced rendering per documented fixture", () => {
    expect([...fences.keys()].sort()).toEqual(["bare", "call", "contextItems", "function", "moduleWithBinding", "nested"]);
  });
  for (const [name, text] of fences) {
    it(`the "${name}" fence equals renderPrompt(fixtures.${name}).messages[0]`, () => {
      expect(text).toBe(renderPrompt(fixtures[name as keyof typeof fixtures]).messages[0]?.content);
    });
  }
});
