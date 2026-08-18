import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";

describe("pass-through lowering", () => {
  it("emits plain TS byte-identical, no runtime import, valid map", () => {
    const src = 'const greeting: string = "hi";\nexport function add(a: number, b: number) {\n  return a + b;\n}\n';
    const result = compileNola(src, "plain.tsi");
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toBe(src);
    expect(result.code).not.toContain("nola-lang/runtime");
    expect(result.meta.nolaFunctions).toEqual([]);
    expect(result.map.mappings.length).toBeGreaterThan(0);
    expect(result.map.sources).toEqual(["plain.tsi"]);
  });

  it("propagates parse diagnostics without throwing", () => {
    const result = compileNola("const = 1;", "bad.tsi");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("NOLA1001");
    expect(result.code).toBe("const = 1;");
  });
});
