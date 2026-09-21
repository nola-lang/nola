import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNolaLanguagePlugin, NolaVirtualCode } from "@nola-lang/language-core";
import { defaultMapperFactory } from "@volar/language-core";
import type ts from "typescript";
import { describe, expect, it } from "vitest";

function snap(text: string): ts.IScriptSnapshot {
  return {
    getText: (a, b) => text.slice(a, b),
    getLength: () => text.length,
    getChangeRange: () => undefined,
  };
}

const plugin = createNolaLanguagePlugin<string>((id) => id);

function create(text: string, id = "/proj/a.tsi"): NolaVirtualCode {
  const code = plugin.createVirtualCode?.(id, "nola", snap(text), {} as never);
  if (!(code instanceof NolaVirtualCode)) throw new Error("no virtual code");
  return code;
}

function generatedText(code: NolaVirtualCode): string {
  const s = code.embeddedCodes[0].snapshot;
  return s.getText(0, s.getLength());
}

describe("createNolaLanguagePlugin", () => {
  it("identifies .tsi and produces a typescript embedded code", () => {
    expect(plugin.getLanguageId("/proj/a.tsi")).toBe("nola");
    expect(plugin.getLanguageId("/proj/a.ts")).toBeUndefined();
    const code = create("const i = ..`x`<string>;\n");
    expect(code.languageId).toBe("nola");
    expect(code.embeddedCodes[0].languageId).toBe("typescript");
    expect(generatedText(code)).toContain("__nola.intents.ExtractIntent<string>");
    expect(code.diagnostics).toEqual([]);
    expect(code.stale).toBe(false);
  });

  it("tolerant mode: broken construct becomes an inert placeholder and reports diagnostics", () => {
    const code = create("const p = ..5;\nconst ok = ..`y`<string>;\n");
    expect(code.stale).toBe(false);
    // the marker's own bytes would leave a dot where the editor maps the
    // cursor, which is what pulled the global scope into the suggest widget
    expect(generatedText(code)).toContain("(undefined as never)");
    expect(generatedText(code)).not.toContain("..5");
    expect(generatedText(code)).toContain("ExtractIntent<string>");
    expect(code.diagnostics.map((d) => d.code)).toContain("NOLA1005");
  });

  it("last-good: a bailed update keeps the previous generated code, marks stale", () => {
    const code = create("const i = ..`x`<string>;\n");
    const good = generatedText(code);
    const updated = plugin.updateVirtualCode?.("/proj/a.tsi", code, snap("const i = ..`x`<str"), {} as never);
    const current = updated instanceof NolaVirtualCode ? updated : code;
    if (current.stale) {
      expect(generatedText(current)).toBe(good);
      expect(current.diagnostics.length).toBeGreaterThan(0);
    } else {
      // tolerant recovery handled it without bailing — also acceptable; the
      // hard requirement is: no throw, diagnostics present, code served.
      expect(current.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it("honors an injected compiler config (underivableContextType)", () => {
    const pruning = createNolaLanguagePlugin<string>((id) => id, {
      compilerConfig: () => ({ underivableContextType: "prune" }),
    });
    const src = [
      "type User = { name: string; cb: () => void };",
      "infer function analyze(.user: User) {",
      "  return 1;",
      "}",
      "",
    ].join("\n");
    const code = pruning.createVirtualCode?.("/proj/a.tsi", "nola", snap(src), {} as never);
    if (!(code instanceof NolaVirtualCode)) throw new Error("no virtual code");
    expect(code.diagnostics).toEqual([]);
    expect(code.derivations.map((d) => [d.kind, d.policy])).toEqual([["context", "prune"]]);

    // the default plugin (no config anywhere near the fake path) errors
    const strict = create(src);
    expect(strict.diagnostics).toEqual([]);
    expect(strict.derivations.map((d) => d.policy)).toEqual(["error"]);
  });

  it("discovers nola.config.ts on disk and picks up edits by mtime", () => {
    const dir = mkdtempSync(join(tmpdir(), "nola-lc-cfg-"));
    const configPath = join(dir, "nola.config.ts");
    writeFileSync(configPath, 'export default { compiler: { underivableContextType: "prune" } };\n');
    const src = [
      "type User = { name: string; cb: () => void };",
      "infer function analyze(.user: User) {",
      "  return 1;",
      "}",
      "",
    ].join("\n");
    const id = join(dir, "a.tsi");
    const code = plugin.createVirtualCode?.(id, "nola", snap(src), {} as never);
    if (!(code instanceof NolaVirtualCode)) throw new Error("no virtual code");
    expect(code.diagnostics).toEqual([]);
    expect(code.derivations.map((d) => [d.kind, d.policy])).toEqual([["context", "prune"]]);

    // config edit: next recompile of the SAME virtual code sees the new mode
    writeFileSync(configPath, 'export default { compiler: { underivableContextType: "error" } };\n');
    const future = Date.now() / 1000 + 5;
    utimesSync(configPath, future, future);
    plugin.updateVirtualCode?.(id, code, snap(src), {} as never);
    expect(code.derivations.map((d) => d.policy)).toEqual(["error"]);
  });

  it("typescript integration exposes the embedded code as the service script", () => {
    const code = create("const i = ..`x`<string>;\n");
    const script = plugin.typescript?.getServiceScript(code);
    expect(script?.extension).toBe(".ts");
    expect(script?.code).toBe(code.embeddedCodes[0]);
    expect(plugin.typescript?.extraFileExtensions).toEqual([
      { extension: "tsi", isMixedContent: false, scriptKind: 7 },
    ]);
  });
});

describe("NolaVirtualCode: what a bailed snapshot may serve", () => {
  // Still an irrecoverable parse: the placeholder recovery is once-only, and
  // `foo(` needs a `)` the tokenizer never delivers.
  const GOOD = "const i = ..`x`<string>;\n";
  const BAILS = "const i = ..`x`<string>;\nfoo(\n";

  it("the root mapping admits diagnostics, so nola errors never depend on the embedded mapper", () => {
    const code = create(GOOD);
    expect(code.mappings).toHaveLength(1);
    expect(code.mappings[0]?.data).toMatchObject({ verification: true, format: true });
  });

  it("stale last-good mappings paint no semantic tokens — they describe a text that is not the document", () => {
    const code = create(GOOD);
    expect(code.embeddedCodes[0].mappings.some((m) => m.data.semantic)).toBe(true);
    const updated = plugin.updateVirtualCode?.("/proj/a.tsi", code, snap(BAILS), {} as never);
    const current = updated instanceof NolaVirtualCode ? updated : code;
    expect(current.stale).toBe(true);
    expect(current.embeddedCodes[0].mappings.some((m) => m.data.semantic)).toBe(false);
    // everything else survives: completion, hover, navigation, verification
    expect(current.embeddedCodes[0].mappings.some((m) => m.data.completion)).toBe(true);
    expect(current.embeddedCodes[0].mappings.some((m) => m.data.verification)).toBe(true);
    // and a good snapshot restores them
    const restored = plugin.updateVirtualCode?.("/proj/a.tsi", current, snap(GOOD), {} as never);
    const back = restored instanceof NolaVirtualCode ? restored : current;
    expect(back.stale).toBe(false);
    expect(back.embeddedCodes[0].mappings.some((m) => m.data.semantic)).toBe(true);
  });
});

// Volar keys four caches on the IDENTITY of the embedded snapshot object:
// TypeScript's script version, the project version, the source-map memo and
// the embedded document version. A fresh object for the same text forces a
// full TypeScript re-parse and re-check, a source-map rebuild and a
// derivation pass. So an update whose generated text is unchanged — the
// same source set again, or a bailed keystroke served last-good — returns
// the previous embedded snapshot (and mappings) instead of a copy.
describe("NolaVirtualCode: snapshot identity across updates", () => {
  const GOOD = "const i = ..`x`<string>;\n";
  const OTHER = "const j = ..`y`<number>;\n";
  const BAILS = "const i = ..`x`<string>;\nfoo(\n";

  function update(code: NolaVirtualCode, text: string): NolaVirtualCode {
    const updated = plugin.updateVirtualCode?.("/proj/a.tsi", code, snap(text), {} as never);
    return updated instanceof NolaVirtualCode ? updated : code;
  }

  it("the same source set again serves the same embedded snapshot object", () => {
    const code = create(GOOD);
    const before = code.embeddedCodes[0];
    const after = update(code, GOOD).embeddedCodes[0];
    expect(after.snapshot).toBe(before.snapshot);
    expect(after.mappings).toBe(before.mappings);
  });

  it("a bailed keystroke serves the last-good snapshot OBJECT, and so does the next one", () => {
    const code = create(GOOD);
    const good = code.embeddedCodes[0].snapshot;
    const first = update(code, BAILS);
    expect(first.stale).toBe(true);
    expect(first.embeddedCodes[0].snapshot).toBe(good);
    const staleMappings = first.embeddedCodes[0].mappings;
    const second = update(first, `${BAILS}\n`);
    expect(second.embeddedCodes[0].snapshot).toBe(good);
    expect(second.embeddedCodes[0].mappings).toBe(staleMappings);
  });

  // The trap the LSP e2e caught: typing the second `.` of `ask ..` lowers to
  // the SAME generated text as `ask .` (both markers become the inert
  // placeholder) but the broken span is one character longer, and the
  // mappings must follow — served under the old mappings, the cursor after
  // `..` fell into a verbatim range and TypeScript completed the global scope.
  it("the same generated text from a DIFFERENT source is a new embedded code with its own mappings", () => {
    const one = "infer function f() {\n  const x = ask .\n}\n";
    const two = "infer function f() {\n  const x = ask ..\n}\n";
    const code = create(one);
    const before = code.embeddedCodes[0];
    const after = update(code, two).embeddedCodes[0];
    const text = (c: typeof before) => c.snapshot.getText(0, c.snapshot.getLength());
    expect(text(after)).toBe(text(before)); // premise: identical generated text
    expect(after).not.toBe(before);
    expect(after.mappings).not.toBe(before.mappings);
    // the cursor after `..` has no completion-enabled mapping under the new
    // mappings — and WOULD have one under the old (that was the global-scope list)
    const cursor = two.indexOf("..") + 2;
    const completable = (mappings: typeof after.mappings) =>
      [...defaultMapperFactory(mappings).toGeneratedLocation(cursor)].filter(([, m]) => m.data.completion);
    expect(completable(before.mappings)).not.toEqual([]);
    expect(completable(after.mappings)).toEqual([]);
  });

  it("a different lowering is a new snapshot", () => {
    const code = create(GOOD);
    const before = code.embeddedCodes[0].snapshot;
    const after = update(code, OTHER).embeddedCodes[0].snapshot;
    expect(after).not.toBe(before);
    expect(after.getText(0, after.getLength())).toContain("ExtractIntent<number>");
  });

  it("recovering from a bail to the same good text serves the original object again", () => {
    const code = create(GOOD);
    const good = code.embeddedCodes[0];
    const back = update(update(code, BAILS), GOOD).embeddedCodes[0];
    expect(back.snapshot).toBe(good.snapshot);
    expect(back.mappings).toBe(good.mappings);
    expect(back.mappings.some((m) => m.data.semantic)).toBe(true);
  });
});
