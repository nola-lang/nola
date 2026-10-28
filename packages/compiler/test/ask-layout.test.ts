import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";
import { typecheckLowered } from "./helpers/typecheck.js";

// The debugger binds a .tsi breakpoint raw, by line, on the compiled script
// (AGENTS.md "LAYOUT IS LOAD-BEARING"), so the lowered body must keep every
// line terminator of the source. Every multi-line ask shape: the type on its
// own line (the colon or `<T>` spelling), a value or a text on the next line
// (a line break alone never ends a sequence, 2026-10-15), a list spanning
// lines, a call intent's arguments on their own lines.
const SHAPES: Array<[string, string]> = [
  ["an extract with the type on its own line", "const r = ask `p`\n  : string;\n"],
  ["an extract with `<T>` on its own line", "const r = ask `p`\n  <string>;\n"],
  ["a tool list with the type on its own line", "declare function fn(): string;\nconst r = ask `p` [fn]\n  : string;\n"],
  [
    "a tool list spanning lines",
    "declare function a(): string;\ndeclare function b(): string;\nconst r = ask `p` [\n  a,\n  b,\n]: string;\n",
  ],
  [
    "a sequence: a value, then the type on its own line",
    "declare const something: number[];\nconst f = ask `p` something.map((x) => x + 1)\n  : string[];\n",
  ],
  [
    "a sequence: a call part, then a text, then a value on the next line",
    "declare function foo(a: string): string[];\ndeclare const something: number[];\nconst files = ask `the files` foo(`a`: string) `and`\nsomething.map((x) => x + 1);\n",
  ],
  [
    "one part per line",
    "declare function searchFiles(): string[];\ndeclare function readFile(): string;\ndeclare const patterns: string[];\nconst files = ask\n  `the files`\n  [searchFiles, readFile]\n  `use these`\n  patterns: string[];\n",
  ],
  [
    "a call intent with its arguments on their own lines",
    "declare function createTicket(a: string, b: number): void;\nconst t = ask createTicket(\n  `the title`: string,\n  2,\n);\n",
  ],
  [
    "a hinted call intent with its arguments on their own lines",
    "declare function createTicket(a: string, b: number): void;\nconst t = ask createTicket`hint`(\n  `the title`: string,\n  2,\n);\n",
  ],
];

describe("an ask never drops a line terminator", () => {
  it.each(SHAPES)("%s", (_name, src) => {
    const r = compileNola(src, "x.tsi");
    expect(r.diagnostics).toEqual([]);
    const appendix = r.meta.spans.find((s) => s.kind === "appendix");
    const body = r.code.slice(0, appendix?.generatedStart ?? r.code.length);
    expect(body.split("\n").length).toBe(src.split("\n").length);
    expect(typecheckLowered({ "x.ts": r.code })).toEqual([]);
  });
});
