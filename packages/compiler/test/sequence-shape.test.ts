import { sequenceShapes } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";

// The editor formats a .tsi as TypeScript, and TypeScript's formatter reads
// an ask sequence — `` ask `x` [a] `y`: T `` — as tagged templates and an
// index: it deletes the spaces between the parts and sets a part on its own
// line at the statement's column. The language server lays a sequence out
// itself, from the shapes read here off a tolerant parse: the head tokens,
// the parts with a list's entries, and the type (ask-sequence spec §3.12).
describe("sequenceShapes", () => {
  const at = (source: string, needle: string, nth = 0): number => {
    let i = -1;
    for (let k = 0; k <= nth; k++) i = source.indexOf(needle, i + 1);
    if (i < 0) throw new Error(`no ${JSON.stringify(needle)} in ${JSON.stringify(source)}`);
    return i;
  };
  const span = (source: string, needle: string, nth = 0) => ({ start: at(source, needle, nth), end: at(source, needle, nth) + needle.length });

  it("an ask sequence: the head, the parts, a list's entries and the colon type", () => {
    const source = ["const files = ask `the files` [", "    searchFiles, readFile", "  ] `dsa`  ", "  : string[];", ""].join("\n");
    const shapes = sequenceShapes(source, "a.tsi");
    expect(shapes).toEqual([
      {
        start: at(source, "ask"),
        end: at(source, "string[]") + "string[]".length,
        head: [span(source, "ask")],
        parts: [
          { kind: "text", ...span(source, "`the files`") },
          { kind: "list", start: at(source, "["), end: at(source, "]") + 1, entries: [span(source, "searchFiles"), span(source, "readFile")] },
          { kind: "text", ...span(source, "`dsa`") },
        ],
        type: { kind: "colon", colon: at(source, ": string"), text: span(source, "string[]") },
      },
    ]);
  });

  it("`ask with <name>` has three head tokens; a bare value's span is the parser's, parentheses included", () => {
    const source = "const a = ask with  gpt  `x`  (user)  `y`  : string;\n";
    const [shape] = sequenceShapes(source, "a.tsi") ?? [];
    expect(shape?.start).toBe(at(source, "ask"));
    expect(shape?.head).toEqual([span(source, "ask"), span(source, "with"), span(source, "gpt")]);
    expect(shape?.parts.map((p) => [p.kind, source.slice(p.start, p.end)])).toEqual([
      ["text", "`x`"],
      ["value", "(user)"],
      ["text", "`y`"],
    ]);
    expect(shape?.type).toEqual({ kind: "colon", colon: at(source, ":"), text: span(source, "string") });
    expect(shape?.end).toBe(at(source, "string") + "string".length);
  });

  it("the stored form starts at the sigil with no head; `<T>` is the angle type", () => {
    const source = "const b = ..`x` [tool] <string>;\n";
    const [shape] = sequenceShapes(source, "a.tsi") ?? [];
    expect(shape).toMatchObject({
      start: at(source, ".."),
      end: at(source, "<string>") + "<string>".length,
      head: [],
      type: { kind: "angle", ...span(source, "<string>") },
    });
    expect(shape?.parts.map((p) => p.kind)).toEqual(["text", "list"]);
    expect(shape?.parts[1]?.entries).toEqual([span(source, "tool")]);
  });

  it("a slot template is a shape of its own: the template and its type, no head", () => {
    const source = "const c = createTicket(`title` : string, 2);\n";
    expect(sequenceShapes(source, "a.tsi")).toEqual([
      {
        start: at(source, "`title`"),
        end: at(source, "string") + "string".length,
        head: [],
        parts: [{ kind: "text", ...span(source, "`title`") }],
        type: { kind: "colon", colon: at(source, ":"), text: span(source, "string") },
      },
    ]);
  });

  it("an untyped extractor has no type; shapes come in source order", () => {
    const source = "const a = ask `one`;\nconst b = ask `two` user `three`: string;\n";
    const shapes = sequenceShapes(source, "a.tsi") ?? [];
    expect(shapes.map((s) => [s.start, s.type?.kind ?? null])).toEqual([
      [at(source, "ask"), null],
      [at(source, "ask", 1), "colon"],
    ]);
  });

  it("a context statement is not a shape, a tolerant placeholder is skipped, a bailed parse is null", () => {
    // a context statement's gaps lower inside one tagged template, so the
    // formatter's replaced-span rule already protects them
    expect(sequenceShapes("infer function f(.user: string) {\n  `analyze:`  user `and report`\n}\n", "a.tsi")).toEqual([]);
    expect(sequenceShapes("const p = ..5;\n", "a.tsi")).toEqual([]);
    expect(sequenceShapes("const i = ..`x`<string>;\nfoo(\n", "a.tsi")).toBeNull();
  });
});
