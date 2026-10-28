import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileNola } from "@nola-lang/compiler";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { derivationDiagnostics } from "../src/diagnostics.js";

const REPO = fileURLToPath(new URL("../../..", import.meta.url)).replace(/\\/g, "/").replace(/\/$/, "");

// A bare value's type is a courtesy to the model (spec 2026-10-12 §3.5): the
// editor's lazy pass says nothing when the walk cannot type it.
describe("editor lazy pass: value requests", () => {
  it("reports nothing for an underivable value", () => {
    const root = mkdtempSync(join(tmpdir(), "nola-diag-value-")).replace(/\\/g, "/");
    const source = "declare const m: Map<string, number>;\nconst r = ask `use` m `go`: string;\n";
    const tsi = `${root}/main.tsi`;
    const p1 = compileNola(source, tsi, { sourceRoot: root, underivableContextType: "error" });
    expect(p1.meta.derivations.map((d) => d.kind)).toEqual(["extract", "value"]);
    // the program's file IS the phase-1 output, so `lowered` offsets need no leading offset
    const generated = `${root}/main.tsi.ts`;
    writeFileSync(generated, p1.code);
    const program = ts.createProgram([generated], {
      strict: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      skipLibCheck: true,
      noEmit: true,
      baseUrl: root,
      paths: { "@nola-lang/runtime": [`${REPO}/packages/runtime/src/types/decision.ts`] },
    });
    const out = derivationDiagnostics(program, generated, p1.meta.derivations, { sourceRoot: root });
    expect(out).toEqual([]);
  });
});
