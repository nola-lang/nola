import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";

describe("emit contract 5 lowering", () => {
  it("named type lowers to an accessor call + hoisted accessor function", () => {
    const src = "type User = { name: string };\nconst i = ..`who`<User>;\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain('type: __nola.types.ref("User", __nola_type_User), loc:');
    expect(code).toContain(
      'function __nola_type_User(): import("@nola-lang/runtime").InferType<unknown> { return __nola.types.object({ name: __nola.types.string() }); }',
    );
    expect(code).toContain("__nola.useRuntime(11);");
  });

  it("recursive same-file type lowers (ban lifted) with a self-ref", () => {
    const src = "type Node = { label: string; kids?: Node[] };\nconst i = ..`tree`<Node>;\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain('__nola.types.ref("Node", __nola_type_Node)');
  });

  it("transitive named types each get one accessor", () => {
    const src = [
      "type Address = { city: string };",
      "type User = { name: string; home: Address };",
      "const a = ..`a`<User>;",
      "const b = ..`b`<User>;",
      "",
    ].join("\n");
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code.match(/function __nola_type_User\(\)/g)).toHaveLength(1);
    expect(code.match(/function __nola_type_Address\(\)/g)).toHaveLength(1);
  });

  it("untyped extractor emits a string combinator", () => {
    const { code } = compileNola("const i = ..`free`;\n", "x.tsi");
    expect(code).toContain("type: __nola.types.string(), loc:");
  });

  it("inline object type embeds the combinator expression at the ask site", () => {
    const { code } = compileNola("const i = ..`x`<{ n: number }>;\n", "x.tsi");
    expect(code).toContain("type: __nola.types.object({ n: __nola.types.number() }), loc:");
  });
});
