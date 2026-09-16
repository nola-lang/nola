import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";

const INERT = "(undefined as never)";

// Since emit 15 every derivation site calls an appendix accessor whose body the
// checker fills in (finalizeDerivations); phase 1 only records the requests.
describe("emit contract 5 lowering (phase-1 shape since emit 15)", () => {
  it("named type lowers to a site-accessor call + an inert accessor + a request", () => {
    const src = "type User = { name: string };\nconst i = ..`who`<User>;\n";
    const { code, diagnostics, meta } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain("type: __nola_type_$1(), loc:");
    expect(code).toContain(`function __nola_type_$1(): import("@nola-lang/runtime").InferType<unknown> { return ${INERT}; }`);
    expect(code).toContain("__nola.useRuntime(16);");
    expect(meta.derivations).toHaveLength(1);
    expect(code.slice(meta.derivations[0]?.lowered.start, meta.derivations[0]?.lowered.end)).toBe("User");
  });

  it("recursive same-file type lowers (ban lifted): the request carries the name, nothing else", () => {
    const src = "type Node = { label: string; kids?: Node[] };\nconst i = ..`tree`<Node>;\n";
    const { code, diagnostics, meta } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).not.toContain("__nola.types.ref(");
    expect(meta.derivations.map((d) => d.accessor)).toEqual(["__nola_type_$1"]);
  });

  it("two extractors over one named type get one site accessor each (named accessors come from the checker)", () => {
    const src = [
      "type Address = { city: string };",
      "type User = { name: string; home: Address };",
      "const a = ..`a`<User>;",
      "const b = ..`b`<User>;",
      "",
    ].join("\n");
    const { code, diagnostics, meta } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(meta.derivations.map((d) => d.accessor)).toEqual(["__nola_type_$1", "__nola_type_$2"]);
    expect(code.match(/function __nola_type_\$1\(\)/g)).toHaveLength(1);
    expect(code.match(/function __nola_type_\$2\(\)/g)).toHaveLength(1);
    expect(code).not.toContain("__nola_type_User");
  });

  it("untyped extractor emits a string combinator inline (no request)", () => {
    const { code, meta } = compileNola("const i = ..`free`;\n", "x.tsi");
    expect(code).toContain("type: __nola.types.string(), loc:");
    expect(meta.derivations).toEqual([]);
  });

  it("inline object type is a site accessor whose request points at the object literal text", () => {
    const { code, meta } = compileNola("const i = ..`x`<{ n: number }>;\n", "x.tsi");
    expect(code).toContain("type: __nola_type_$1(), loc:");
    expect(code.slice(meta.derivations[0]?.lowered.start, meta.derivations[0]?.lowered.end)).toBe("{ n: number }");
  });
});
