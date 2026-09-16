import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";

// Cross-file derivation (view imports, qualified refs, meta.views) is decided by
// the checker in finalizeDerivations — see packages/derive/test/service.test.ts
// and packages/compiler/test/finalize.test.ts. Phase 1 only records the site.
describe("cross-file type lowering (phase 1)", () => {
  it("an imported type is a site request; no import, ref or view is emitted by phase 1", () => {
    const src = 'import type { Person } from "./models.js";\nconst i = ..`who`<Person>;\n';
    const { code, diagnostics, meta } = compileNola(src, "/proj/src/x.tsi", { sourceRoot: "/proj" });
    expect(diagnostics).toEqual([]);
    expect(code).toContain("type: __nola_type_$1(), loc:");
    expect(code).not.toContain("./models.tsi");
    expect(meta.views).toEqual([]);
    expect(meta.derivations).toEqual([
      expect.objectContaining({ accessor: "__nola_type_$1", kind: "extract" }),
    ]);
    expect(code.slice(meta.derivations[0]?.lowered.start, meta.derivations[0]?.lowered.end)).toBe("Person");
  });

  it("meta.views is [] on plain files and on the strict bail path", () => {
    expect(compileNola("const x = 1;\n", "x.tsi").meta.views).toEqual([]);
    expect(compileNola("const p = ..5;\n", "x.tsi").meta.views).toEqual([]);
  });
});
