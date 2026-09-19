import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileNola } from "@nola-lang/compiler";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { derivationDiagnostics } from "../src/diagnostics.js";

const REPO = fileURLToPath(new URL("../../..", import.meta.url)).replace(/\\/g, "/").replace(/\/$/, "");

describe("editor lazy pass: NOLA2015", () => {
  it("reports malformed decision criteria at the context site under prune, and at the extract site", () => {
    const root = mkdtempSync(join(tmpdir(), "nola-diag-")).replace(/\\/g, "/");
    const source = "type Bad = Choice<{ only: null }>;\ninfer function f(.d: Bad) {\n  return ask ..`x`<Bad>;\n}\n";
    const tsi = `${root}/main.tsi`;
    const p1 = compileNola(source, tsi, { sourceRoot: root, underivableContextType: "prune" });
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
    expect(out.map((d) => d.code)).toEqual(["NOLA2015", "NOLA2015"]);
    expect(out.every((d) => d.message === "Bad: Choice needs 2 to 255 labels, got 1")).toBe(true);
    // each diagnostic points at the request's lowered type text
    for (const [i, d] of out.entries()) {
      const req = p1.meta.derivations[i];
      expect(p1.code.slice(d.generatedStart, d.generatedEnd)).toBe(p1.code.slice(req?.lowered.start, req?.lowered.end));
    }
  });
});
