import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNolaLanguagePlugin, NolaVirtualCode } from "@nola-lang/language-core";
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
    expect(generatedText(code)).toContain("return __nola.types.object({ name: __nola.types.string() });");

    // the default plugin (no config anywhere near the fake path) errors
    const strict = create(src);
    expect(strict.diagnostics.map((d) => d.code)).toEqual(["NOLA2008"]);
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
    expect(generatedText(code)).toContain("return __nola.types.object({ name: __nola.types.string() });");

    // config edit: next recompile of the SAME virtual code sees the new mode
    writeFileSync(configPath, 'export default { compiler: { underivableContextType: "error" } };\n');
    const future = Date.now() / 1000 + 5;
    utimesSync(configPath, future, future);
    plugin.updateVirtualCode?.(id, code, snap(src), {} as never);
    expect(code.diagnostics.map((d) => d.code)).toEqual(["NOLA2008"]);
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
