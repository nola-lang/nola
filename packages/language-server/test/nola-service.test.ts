import { createNolaLanguagePlugin, NolaVirtualCode } from "@nola-lang/language-core";
import { createNolaServicePlugin } from "@nola-lang/language-server";
import { defaultMapperFactory } from "@volar/language-core";
import type { LanguageServiceContext } from "@volar/language-service";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { URI } from "vscode-uri";

const nolaServicePlugin = createNolaServicePlugin(ts);

function snap(text: string) {
  return {
    getText: (a: number, b: number) => text.slice(a, b),
    getLength: () => text.length,
    getChangeRange: () => undefined,
  };
}

const BROKEN = "const p = ..5;\nconst ok = ..`y`<string>;\n";

/** Fake just the context seams the plugin touches; the mapper is Volar's real one. */
function makeContext(sourceUri: URI, root: NolaVirtualCode): LanguageServiceContext {
  const embedded = root.embeddedCodes[0];
  return {
    decodeEmbeddedDocumentUri: (uri: URI) =>
      uri.scheme === "volar-embedded" ? ([sourceUri, embedded.id] as [URI, string]) : undefined,
    language: {
      scripts: {
        get: (id: URI) =>
          id.toString() === sourceUri.toString()
            ? { generated: { root, embeddedCodes: new Map([[embedded.id, embedded]]) } }
            : undefined,
      },
      maps: {
        get: () => defaultMapperFactory(embedded.mappings),
      },
    },
  } as unknown as LanguageServiceContext;
}

describe("nolaServicePlugin", () => {
  it("publishes nola-native diagnostics through the embedded document", () => {
    const plugin = createNolaLanguagePlugin<URI>((uri) => uri.fsPath.replace(/\\/g, "/"));
    const sourceUri = URI.file("/proj/a.tsi");
    const root = plugin.createVirtualCode?.(sourceUri, "nola", snap(BROKEN), {} as never);
    if (!(root instanceof NolaVirtualCode)) throw new Error("no virtual code");

    const embeddedText = root.embeddedCodes[0].snapshot.getText(0, root.embeddedCodes[0].snapshot.getLength());
    const instance = nolaServicePlugin.create(makeContext(sourceUri, root));
    const document = {
      uri: "volar-embedded://ts/a.tsi",
      languageId: "typescript",
      positionAt: (offset: number) => {
        const before = embeddedText.slice(0, offset);
        return { line: before.split("\n").length - 1, character: offset - (before.lastIndexOf("\n") + 1) };
      },
    } as never;
    const diags = (instance.provideDiagnostics?.(document, {} as never) ?? []) as Array<{
      code?: string | number;
      source?: string;
      severity?: number;
      range: { start: { line: number; character: number } };
    }>;
    expect(diags.length).toBeGreaterThanOrEqual(1);
    const d = diags.find((x) => x.code === "NOLA1005");
    expect(d).toBeDefined();
    expect(d?.source).toBe("nola");
    expect(d?.severity).toBe(1);
    expect(d?.range.start.line).toBe(0);
    expect(d?.range.start.character).toBeGreaterThan(0);
  });

  it("formats the .tsi source directly, leaving nola constructs untouched", async () => {
    const content = [
      "export infer function fmt(q: string) {",
      "  const s = ask ..`n`<string>;",
      "for  (const c of q) {",
      "  }",
      "  return s;",
      "}",
      "",
    ].join("\n");
    const lineStarts = [0];
    for (let i = 0; i < content.length; i++) if (content[i] === "\n") lineStarts.push(i + 1);
    const document = {
      uri: "file:///proj/a.tsi",
      languageId: "nola",
      getText: () => content,
      offsetAt: (p: { line: number; character: number }) => (lineStarts[p.line] ?? content.length) + p.character,
      positionAt: (offset: number) => {
        const before = content.slice(0, offset);
        return { line: before.split("\n").length - 1, character: offset - (before.lastIndexOf("\n") + 1) };
      },
    };
    const instance = nolaServicePlugin.create({} as LanguageServiceContext);
    const fullRange = { start: document.positionAt(0), end: document.positionAt(content.length) };
    const edits = ((await instance.provideDocumentFormattingEdits?.(
      document as never,
      fullRange,
      { tabSize: 2, insertSpaces: true },
      undefined,
      {} as never,
    )) ?? []) as Array<{
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
      newText: string;
    }>;
    let formatted = content;
    for (const edit of [...edits].sort(
      (a, b) => document.offsetAt(b.range.start) - document.offsetAt(a.range.start),
    )) {
      formatted =
        formatted.slice(0, document.offsetAt(edit.range.start)) +
        edit.newText +
        formatted.slice(document.offsetAt(edit.range.end));
    }
    expect(formatted).toContain("\n  for (const c of q) {");
    expect(formatted).toContain("  const s = ask ..`n`<string>;");
  });

  it("returns nothing for non-embedded documents", () => {
    const context = {
      decodeEmbeddedDocumentUri: () => undefined,
      language: { scripts: { get: () => undefined } },
    } as unknown as LanguageServiceContext;
    const instance = nolaServicePlugin.create(context);
    const document = { uri: "file:///proj/a.ts", languageId: "typescript" } as never;
    expect(instance.provideDiagnostics?.(document, {} as never)).toBeUndefined();
  });
});
