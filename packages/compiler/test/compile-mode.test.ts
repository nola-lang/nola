import { compileNola, loweredVirtualNameFor } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";

describe("meta.mode + virtual naming", () => {
  it("lowered files report mode 'lowered'", () => {
    expect(compileNola("const i = ..`x`<string>;\n", "x.tsi").meta.mode).toBe("lowered");
    expect(compileNola("const plain = 1;\n", "x.tsi").meta.mode).toBe("lowered");
  });

  it("tolerant partial lowering is still 'lowered'", () => {
    const r = compileNola("const p = ..5;\nconst ok = ..`y`<string>;\n", "x.tsi", { tolerant: true });
    expect(r.meta.mode).toBe("lowered");
  });

  it("an irrecoverable parse bails with mode 'bailed'", () => {
    const broken = "const p = ..5;\n"; // strict mode: parse error -> bail
    const r = compileNola(broken, "x.tsi");
    expect(r.code).toBe(broken);
    expect(r.meta.mode).toBe("bailed");
  });

  it("loweredVirtualNameFor appends .ts and normalizes separators", () => {
    expect(loweredVirtualNameFor("C:\\proj\\src\\a.tsi")).toBe("C:/proj/src/a.tsi.ts");
    expect(loweredVirtualNameFor("/proj/src/a.tsi")).toBe("/proj/src/a.tsi.ts");
  });
});
