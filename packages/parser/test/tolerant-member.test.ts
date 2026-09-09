import { parseNola } from "@nola-lang/parser";
import { describe, expect, it } from "vitest";

// A member access whose name is still being typed — `person.` with the cursor
// after the dot — is the single most common editor state there is, and it
// carries no Nola construct at all. Babel's parseMember reaches unexpected(),
// which THROWS even under errorRecovery, so the whole file bailed and the
// editor served stale lowered output (the cursor then mapped through
// coordinates that meant nothing and TypeScript answered the `.`-triggered
// completion with the global scope). TypeScript's own parser recovers this
// state with a missing identifier; tolerant mode does the same and records
// NOTHING — the bytes stay verbatim in the lowered text, so TypeScript
// reports its own "Identifier expected" through the verbatim mapping, exactly
// as it would in a .ts file, and a nola diagnostic would only double it.
describe("tolerant recovery: dangling member access", () => {
  const cases: Array<[string, string]> = [
    ["before `;`", "infer function go() {\n  const p = ask ..`x`<{ a: string }>;\n  return p.;\n}\n"],
    ["before `}`", "infer function go() {\n  const p = ask ..`x`<{ a: string }>;\n  p.\n}\n"],
    ["before `)`", "const r = f(p.);\n"],
    ["optional chain", "const r = p?.;\n"],
    ["at end of input", "p."],
  ];
  for (const [what, src] of cases) {
    it(`recovers \`x.\` ${what} without a diagnostic`, () => {
      const { ast, diagnostics } = parseNola(src, "t.tsi", { tolerant: true });
      expect(ast).not.toBeNull();
      expect(diagnostics).toEqual([]);
    });
  }

  it("strict mode still throws the ordinary syntax error", () => {
    const { ast, diagnostics } = parseNola("const r = p.;\n", "t.tsi");
    expect(ast).toBeNull();
    expect(diagnostics[0]?.code).toBe("NOLA1001");
  });
});
