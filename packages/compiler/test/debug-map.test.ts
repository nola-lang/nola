import { decode } from "@jridgewell/sourcemap-codec";
import { compileNola, layoutMap, wrapperLinesOf } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";

const SRC = "infer function greet(.name: string) {\n  `Say hello.`\n  return ask `a greeting`: string;\n}\n";

describe("the loader's debug map (layout mode)", () => {
  it("drops every segment on a wrapper line and keeps the body's", () => {
    const lowered = compileNola(SRC, "/p.tsi", { sourceRoot: "/" });
    const wrappers = wrapperLinesOf(lowered);
    expect(wrappers.size).toBeGreaterThan(0);
    const map = JSON.parse(layoutMap(lowered)) as { mappings: string; sources: string[] };
    const lines = decode(map.mappings);
    for (const w of wrappers) expect(lines[w] ?? []).toEqual([]);
    // the ask line (source line 3, index 2) is still mapped somewhere in the generated text
    expect(lines.some((segs) => segs.some((s) => s[2] === 2))).toBe(true);
    expect(map.sources).toEqual(["/p.tsi"]);
  });

  it("names the one source as the caller asks", () => {
    const lowered = compileNola(SRC, "/p.tsi", { sourceRoot: "/" });
    const map = JSON.parse(layoutMap(lowered, "nola://playground/p.tsi")) as { sources: string[] };
    expect(map.sources).toEqual(["nola://playground/p.tsi"]);
  });
});
