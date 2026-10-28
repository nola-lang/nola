import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileNola } from "@nola-lang/compiler";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { derivationDiagnostics } from "../src/diagnostics.js";

// The editor's lazy pass runs the same per-ask name-collision check as
// finalizeDerivations (spec 2026-10-09 §3.4, §3.11): a spread's `search`
// beside a written `search` is NOLA2018 at the later entry in VS Code too,
// not only under `nola check`.
describe("editor lazy pass: tool name collisions", () => {
  it("reports a declared name that collides with an earlier entry of the same ask, at the later entry", () => {
    const root = mkdtempSync(join(tmpdir(), "nola-diag-tools-")).replace(/\\/g, "/");
    const source = "declare function search(q: string): void;\ndeclare const g: { search(q: string): void };\nconst i = ask `p` [search, ...g]: string;\n";
    const tsi = `${root}/main.tsi`;
    const p1 = compileNola(source, tsi, { sourceRoot: root });
    const generated = `${root}/main.tsi.ts`;
    writeFileSync(generated, p1.code);
    const program = ts.createProgram([generated], {
      strict: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      skipLibCheck: true,
      noEmit: true,
    });
    const out = derivationDiagnostics(program, generated, p1.meta.derivations, { sourceRoot: root });
    expect(out?.map((d) => d.code)).toEqual(["NOLA2018"]);
    expect(out?.[0]?.message).toContain("'search' is offered twice");
    const spread = p1.meta.derivations[2];
    expect(p1.code.slice(out?.[0]?.generatedStart, out?.[0]?.generatedEnd)).toBe("g");
    expect(out?.[0]?.generatedStart).toBe(spread?.lowered.start);
  });
});
