import { tagPalette } from "create-nola-lang";
import { describe, expect, it } from "vitest";
import { styleDiagnostics } from "../src/style.js";

describe("styleDiagnostics", () => {
  it("accents a positioned diagnostic: path, dim position, error code, plain message", () => {
    const text = "src/analyze.tsi:15:59 NOLA2008: contextual parameter 'user' cannot be derived";
    expect(styleDiagnostics(text, tagPalette)).toBe(
      "<path>src/analyze.tsi</path><dim>:15:59</dim> <error>NOLA2008</error>: contextual parameter 'user' cannot be derived",
    );
  });

  it("handles Windows paths and TS codes", () => {
    const text = "D:\\app\\src\\main.ts:3:9 TS2322: Type 'string' is not assignable to type 'number'.";
    expect(styleDiagnostics(text, tagPalette)).toBe(
      "<path>D:\\app\\src\\main.ts</path><dim>:3:9</dim> <error>TS2322</error>: Type 'string' is not assignable to type 'number'.",
    );
  });

  it("accents a position-less diagnostic (a dangling view import)", () => {
    const text = 'src/report.tsi NOLA2007: "./missing.tsi" names neither a Nola file nor a TypeScript module';
    expect(styleDiagnostics(text, tagPalette)).toBe(
      '<path>src/report.tsi</path> <error>NOLA2007</error>: "./missing.tsi" names neither a Nola file nor a TypeScript module',
    );
  });

  it("dims the code-frame gutter and paints the caret", () => {
    const text = ["a.tsi:2:5 NOLA1010: bad", "2 | infer function f(.x) {}", "        ^"].join("\n");
    expect(styleDiagnostics(text, tagPalette).split("\n").slice(1)).toEqual([
      "<dim>2 |</dim> infer function f(.x) {}",
      "        <error>^</error>",
    ]);
  });

  it("leaves lines it does not recognise alone", () => {
    const text = 'Set compiler.underivableContextType to "prune".\n\nsomething: else';
    expect(styleDiagnostics(text, tagPalette)).toBe(text);
  });
});
