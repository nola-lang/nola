import { describe, expect, it } from "vitest";
import { evaluatableRange } from "../src/evaluatable-expression.js";

/** Locate a word in the line and return [start, end) offsets. */
function wordAt(line: string, word: string, occurrence = 0): { start: number; end: number } {
  let from = 0;
  for (let i = 0; i <= occurrence; i++) {
    const at = line.indexOf(word, from);
    if (at < 0) throw new Error(`no ${word} in ${line}`);
    if (i === occurrence) return { start: at, end: at + word.length };
    from = at + 1;
  }
  throw new Error("unreachable");
}

function evalText(line: string, word: string, occurrence = 0): string | undefined {
  const w = wordAt(line, word, occurrence);
  const r = evaluatableRange(line, w.start, w.end);
  return r ? line.slice(r.start, r.end) : undefined;
}

describe("evaluatableRange (debug hover expression for .tsi)", () => {
  it("strips the `.` contextual-parameter marker — it is not property access", () => {
    // VS Code's built-in fallback extracts `.address` here, which is a syntax
    // error under evaluate, so the debug hover silently showed nothing.
    const line = "export infer function analyzeAddress`user address checker`(.address: string) {";
    expect(evalText(line, "address", 1)).toBe("address");
  });

  it("the retired `..address` spelling still evaluates as `address`", () => {
    const line = "infer function f(..address: string) {";
    expect(evalText(line, "address", 0)).toBe("address");
  });

  it("a plain identifier evaluates as itself", () => {
    expect(evalText("    await saveAddress(address);", "address")).toBe("address");
  });

  it("keeps property chains ending at the hovered word", () => {
    const line = "  const n = user.person.name;";
    expect(evalText(line, "name")).toBe("user.person.name");
    expect(evalText(line, "person")).toBe("user.person");
    expect(evalText(line, "user")).toBe("user");
  });

  it("optional chains survive", () => {
    expect(evalText("  const n = user?.person;", "person")).toBe("user?.person");
  });

  it("a chain rooted at a contextual parameter drops only the marker", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${...} in .tsi fixture text
    const line = "  const n = ask ..`x ${.user.name}`;";
    expect(evalText(line, "name")).toBe("user.name");
  });
});
