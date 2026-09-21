import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileNola } from "@nola-lang/compiler";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { derivationDiagnostics } from "../src/diagnostics.js";

const REPO = fileURLToPath(new URL("../../..", import.meta.url)).replace(/\\/g, "/").replace(/\/$/, "");

// The editor's lazy pass reads two independently versioned inputs: the phase-1
// requests of the CURRENT virtual code and the language service's program.
// When the program's SourceFile is one edit behind — the text typed after the
// ask site is one character shorter there — the old "leading offset" formula
// (`sourceFile.text.length - embeddedText.length`) turned that skew into a
// -1 shift of every `lowered` range: `<Perso` instead of `Person`, whose
// smallest spanning node is the ExtractIntent CALL, typed Askable<Person>.
// The walk then failed on the interface's first method. In VS Code that was
// an "unsupported method 'withRetry' of Askable<Person>" flashing under <T>
// on every keystroke until the next pass caught up.
describe("editor lazy pass against a program that lags the generated text", () => {
  const before = [
    "interface Person { name: string; age: number }",
    "const person = ask `the person`<Person>;",
    "console",
    "",
  ].join("\n");
  const after = before.replace("console", "console.");

  function programOver(text: string) {
    const root = mkdtempSync(join(tmpdir(), "nola-stale-")).replace(/\\/g, "/");
    const tsi = `${root}/main.tsi`;
    const p1 = compileNola(text, tsi, { sourceRoot: root, tolerant: true });
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
      paths: { "@nola-lang/runtime": [`${REPO}/packages/runtime/src/index.ts`] },
    });
    return { root, generated, p1, program };
  }

  it("the raw leading-offset arithmetic reproduces the bogus Askable<Person> failure", () => {
    const stale = programOver(before);
    const current = compileNola(after, `${stale.root}/main.tsi`, { sourceRoot: stale.root, tolerant: true });
    const leadingOffset = stale.p1.code.length - current.code.length;
    const out = derivationDiagnostics(stale.program, stale.generated, current.meta.derivations, {
      sourceRoot: stale.root,
      leadingOffset,
    });
    expect(out?.map((d) => d.message)).toEqual(["unsupported method 'withRetry' of Askable<Person>"]);
  });

  it("with the generated text to verify against, a lagging program yields no answer at all", () => {
    const stale = programOver(before);
    const current = compileNola(after, `${stale.root}/main.tsi`, { sourceRoot: stale.root, tolerant: true });
    const out = derivationDiagnostics(stale.program, stale.generated, current.meta.derivations, {
      sourceRoot: stale.root,
      generatedText: current.code,
    });
    expect(out).toBeUndefined();
  });

  it("a program at the generated text's version answers, with the offset derived from the text", () => {
    const fresh = programOver(after);
    const out = derivationDiagnostics(fresh.program, fresh.generated, fresh.p1.meta.derivations, {
      sourceRoot: fresh.root,
      generatedText: fresh.p1.code,
    });
    expect(out).toEqual([]);
  });

  it("a whitespace shadow in front of the generated text is admitted and offsets accordingly", () => {
    // decorateLanguageServiceHost serves the .tsi to tsserver as a source-shaped
    // whitespace shadow followed by the generated code
    const root = mkdtempSync(join(tmpdir(), "nola-stale-")).replace(/\\/g, "/");
    const tsi = `${root}/main.tsi`;
    const p1 = compileNola(after, tsi, { sourceRoot: root, tolerant: true });
    const generated = `${root}/main.tsi.ts`;
    const shadow = after.replace(/[^\n]/g, " ");
    writeFileSync(generated, shadow + p1.code);
    const program = ts.createProgram([generated], {
      strict: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      skipLibCheck: true,
      noEmit: true,
      baseUrl: root,
      paths: { "@nola-lang/runtime": [`${REPO}/packages/runtime/src/index.ts`] },
    });
    const out = derivationDiagnostics(program, generated, p1.meta.derivations, { sourceRoot: root, generatedText: p1.code });
    expect(out).toEqual([]);
  });
});
