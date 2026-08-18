import { join } from "node:path";
import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";

const SRC = "infer function classify() {\n  const id = ..`ticket id`<string>;\n  return id;\n}\n";

describe("sourceRoot", () => {
  // Since emit 3 the display path is emitted exactly once per file, in the
  // hoisted `__nola_file_ctx` accessor — intents derive `file` from the lineage.
  it("emits a project-root-relative posix path", () => {
    const file = join("/proj", "src", "a.tsi");
    const { code, diagnostics } = compileNola(SRC, file, { sourceRoot: "/proj" });
    expect(diagnostics).toEqual([]);
    expect(code).toContain('__nola.context.file("src/a.tsi")');
    expect(code).not.toContain("proj");
  });

  it("leaves the path untouched when no sourceRoot is given", () => {
    const { code } = compileNola(SRC, "x.tsi");
    expect(code).toContain('__nola.context.file("x.tsi")');
  });

  it("keeps diagnostics on the absolute path", () => {
    const file = join("/proj", "src", "bad.tsi");
    const { diagnostics } = compileNola("const v = ask ..`v`;\n", file, { sourceRoot: "/proj" });
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].file).toBe(file);
  });

  it("falls back to the absolute path when the file escapes the root", () => {
    const file = join("/elsewhere", "a.tsi");
    const { code } = compileNola(SRC, file, { sourceRoot: join("/proj") });
    expect(code).toContain(JSON.stringify(file).slice(1, -1));
  });
});
