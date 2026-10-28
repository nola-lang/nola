import { ExtractIntent, nolaRuntime, inferTypes as t, toolSource } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { inlineText, instructionParts, normalizeParts, referenceText, wireParts } from "../src/intents/parts.js";

afterEach(() => nolaRuntime.reset());

const searchArgs = t.object({ dir: t.string() });
function searchFiles(dir: string): string[] {
  return [dir];
}

describe("instruction parts (spec 2026-10-12 §3.6)", () => {
  it("a string init is one text part; an unbranded object is refused", () => {
    expect(normalizeParts("p")).toEqual(["p"]);
    expect(() => normalizeParts(["p", { kind: "obj", value: 1, name: "x" } as never])).toThrow(/instruction part/);
  });

  it("the reference text names an input, brackets a list's wire names, describes a call", () => {
    const parts = [
      "use",
      instructionParts.obj({ value: { a: 1 }, name: "admin", type: t.object({ a: t.number() }) }),
      "with",
      instructionParts.tools(toolSource(searchFiles, searchArgs, "fs.search")),
      "then",
      instructionParts.func({
        fn: searchFiles,
        name: "searchFiles",
        args: [new ExtractIntent({ instruction: "a dir", type: t.string(), loc: "1:1" }), 2],
      }),
    ];
    expect(referenceText(parts)).toBe("use admin with [fs_search] then searchFiles(a dir, 2)");
    expect(inlineText(parts)).toBe('use {"a":1} with [fs_search] then searchFiles(a dir, 2)');
  });

  it("the wire parts carry the input's name, native type and JSON value; a text-only sequence has none", () => {
    expect(wireParts(["p"])).toBeUndefined();
    expect(wireParts(["use", instructionParts.obj({ value: new Date(0), name: "when", type: t.date() }), "now"])).toEqual([
      { text: "use" },
      { input: { name: "when", type: "date", value: "1970-01-01T00:00:00.000Z" } },
      { text: "now" },
    ]);
    expect(wireParts(["x", instructionParts.obj({ value: undefined, name: "u" })])).toEqual([{ text: "x" }, { input: { name: "u" } }]);
    expect(wireParts(["x", instructionParts.tools(toolSource(searchFiles, searchArgs, "searchFiles"))])).toEqual([
      { text: "x" },
      { tools: ["searchFiles"] },
    ]);
  });
});
