import { describe, expect, it } from "vitest";
import { type JsonToken, jsonTokens, renderValue } from "../src/json-tokens";

const join = (tokens: JsonToken[]): string => tokens.map((t) => t.text).join("");

describe("jsonTokens", () => {
  it("reproduces JSON.stringify(value, null, 2) byte for byte", () => {
    const fixtures: unknown[] = [
      { ok: true, value: { name: "Ada", age: 36, tags: ["a", "b"], nested: { empty: {}, none: [] } } },
      [1, -2.5, 1e21, "x\"yz\n", null, false],
      "a bare string",
      42,
      null,
      {},
      [],
      { at: new Date("2026-09-07T10:00:00Z"), skipped: undefined, nan: Number.NaN, list: [undefined] },
    ];
    for (const value of fixtures) expect(join(jsonTokens(value))).toBe(JSON.stringify(value, null, 2));
  });

  it("yields no tokens where JSON.stringify yields undefined", () => {
    expect(jsonTokens(undefined)).toEqual([]);
    expect(jsonTokens(() => 1)).toEqual([]);
  });

  it("classifies keys, strings, numbers, literals and punctuation", () => {
    expect(jsonTokens({ a: "s", n: 1, t: true, z: null })).toEqual([
      { kind: "punct", text: "{\n  " },
      { kind: "key", text: '"a"' },
      { kind: "punct", text: ": " },
      { kind: "string", text: '"s"' },
      { kind: "punct", text: ",\n  " },
      { kind: "key", text: '"n"' },
      { kind: "punct", text: ": " },
      { kind: "number", text: "1" },
      { kind: "punct", text: ",\n  " },
      { kind: "key", text: '"t"' },
      { kind: "punct", text: ": " },
      { kind: "literal", text: "true" },
      { kind: "punct", text: ",\n  " },
      { kind: "key", text: '"z"' },
      { kind: "punct", text: ": " },
      { kind: "literal", text: "null" },
      { kind: "punct", text: "\n}" },
    ]);
  });

  it("keeps a top-level string a string token, not a key", () => {
    expect(jsonTokens("hi")).toEqual([{ kind: "string", text: '"hi"' }]);
  });
});

describe("jsonTokens in js format", () => {
  it("leaves identifier keys bare and quotes the rest", () => {
    expect(join(jsonTokens({ name: "Ada", "first-name": "Ada", $ok: 1, _x: 2, "1st": 3 }, "js"))).toBe(
      '{\n  name: "Ada",\n  "first-name": "Ada",\n  $ok: 1,\n  _x: 2,\n  "1st": 3\n}',
    );
    expect(jsonTokens({ name: "Ada" }, "js")[1]).toEqual({ kind: "key", text: "name" });
  });

  it("renders a string that needs escaping in backticks, raw", () => {
    expect(join(jsonTokens("line one\nline two", "js"))).toBe("`line one\nline two`");
    expect(join(jsonTokens('say "hi"\tnow', "js"))).toBe('`say "hi"\tnow`');
    expect(jsonTokens("a\nb", "js")).toEqual([{ kind: "string", text: "`a\nb`" }]);
  });

  it("keeps a plain string double-quoted", () => {
    expect(join(jsonTokens({ s: "plain 'text'" }, "js"))).toBe("{\n  s: \"plain 'text'\"\n}");
  });

  it("escapes what a template literal cannot hold raw", () => {
    const input = ["a", "`b`", "$" + "{c}", "d\\e"].join(" ");
    const escaped = ["`a", "\\`b\\`", "\\$" + "{c}", "d\\\\e`"].join(" ");
    expect(join(jsonTokens(input, "js"))).toBe(escaped);
  });

  it("matches the json format for everything but keys and escaped strings", () => {
    const value = [1, true, null, [], {}, [[2]], "plain"];
    expect(join(jsonTokens(value, "js"))).toBe(JSON.stringify(value, null, 2));
  });
});

describe("renderValue", () => {
  it("is the tokens' text joined", () => {
    expect(renderValue({ a: "b\nc" }, "json")).toBe('{\n  "a": "b\\nc"\n}');
    expect(renderValue({ a: "b\nc" }, "js")).toBe("{\n  a: `b\nc`\n}");
    expect(renderValue(undefined, "json")).toBe("");
  });
});
