import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";

describe("cross-file type lowering", () => {
  it("an imported type emits a qualified ref + companion import + meta.companions", () => {
    const src = 'import type { Person } from "./models.js";\nconst i = ..`who`<Person>;\n';
    const { code, diagnostics, meta } = compileNola(src, "/proj/src/x.tsi", { sourceRoot: "/proj" });
    expect(diagnostics).toEqual([]);
    expect(code).toContain('type: __nola.types.ref("src/models#Person", __nola_type_Person), loc:');
    expect(code).toContain('import { Person as __nola_type_Person } from "./models.nola.js";');
    expect(meta.companions).toEqual(["./models.nola.js"]);
  });

  it("an aliased import binds by local name but refs by source name", () => {
    const src = 'import { Person as P } from "./models.js";\nconst i = ..`who`<P>;\n';
    const { code, diagnostics } = compileNola(src, "/proj/src/x.tsi", { sourceRoot: "/proj" });
    expect(diagnostics).toEqual([]);
    expect(code).toContain('__nola.types.ref("src/models#Person", __nola_type_P)');
    expect(code).toContain('import { Person as __nola_type_P } from "./models.nola.js";');
  });

  it("a LOCAL type referencing an IMPORTED one pulls the companion transitively", () => {
    const src = [
      'import type { Address } from "./geo.js";',
      "type User = { name: string; home: Address };",
      "const i = ..`who`<User>;",
      "",
    ].join("\n");
    const { code, diagnostics, meta } = compileNola(src, "/proj/src/x.tsi", { sourceRoot: "/proj" });
    expect(diagnostics).toEqual([]);
    expect(code).toContain('function __nola_type_User(): import("@nola-lang/runtime").InferType<unknown>');
    expect(code).toContain('__nola.types.ref("src/geo#Address", __nola_type_Address)');
    expect(meta.companions).toEqual(["./geo.nola.js"]);
  });

  it("bare-specifier (package) type imports are NOLA2002 at the ask site", () => {
    const src = 'import type { Thing } from "somepkg";\nconst i = ..`x`<Thing>;\n';
    const { diagnostics } = compileNola(src, "/proj/src/x.tsi", { sourceRoot: "/proj" });
    expect(diagnostics.map((d) => d.code)).toContain("NOLA2002");
    expect(diagnostics[0]?.message).toContain("somepkg");
  });

  it("default imports are not supported for schema types", () => {
    const src = 'import Person from "./models.js";\nconst i = ..`x`<Person>;\n';
    const { diagnostics } = compileNola(src, "/proj/src/x.tsi", { sourceRoot: "/proj" });
    expect(diagnostics.map((d) => d.code)).toContain("NOLA2002");
  });

  it("meta.companions is [] on plain files and on the strict bail path", () => {
    expect(compileNola("const x = 1;\n", "x.tsi").meta.companions).toEqual([]);
    expect(compileNola("const p = ..5;\n", "x.tsi").meta.companions).toEqual([]);
  });
});
