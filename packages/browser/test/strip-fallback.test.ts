import { decode } from "@jridgewell/sourcemap-codec";
import { stripLowered } from "@nola-lang/browser";
import { compileNola } from "@nola-lang/compiler";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = "enum Kind {\n  A = 1,\n  B = 2,\n}\nconsole.log(Kind.A);\nconst x: number = 1;\nconsole.log(x);\n";

describe("stripLowered on non-erasable syntax", () => {
  it("an enum falls back to transform mode with a map whose body lines bind to their source lines", () => {
    const lowered = compileNola(SRC, "/e.tsi", { sourceRoot: "/" });
    expect(lowered.diagnostics).toEqual([]);
    const out = stripLowered(ts, lowered, { sourceUrl: "nola://e.tsi" });
    expect(out.mode).toBe("transform");
    expect(out.code).toMatch(/Kind\[/); // the enum became an object
    expect(out.code).not.toMatch(/sourceMappingURL/); // the map travels separately
    const map = JSON.parse(out.map) as { sources: string[]; sourcesContent?: string[]; mappings: string };
    expect(map.sources).toEqual(["nola://e.tsi"]);
    expect(map.sourcesContent?.[0]).toBe(SRC);
    const lines = decode(map.mappings);
    // `console.log(Kind.A)` is source line 5 (index 4), `console.log(x)` line 7 (index 6): both bind
    for (const sourceLine of [4, 6]) {
      expect(lines.some((segs) => segs.some((s) => s[2] === sourceLine)), `source line ${sourceLine + 1}`).toBe(true);
    }
  });
});
