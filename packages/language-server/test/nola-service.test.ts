import { createNolaLanguagePlugin, NolaVirtualCode } from "@nola-lang/language-core";
import { createNolaServicePlugin } from "@nola-lang/language-server";
import { defaultMapperFactory } from "@volar/language-core";
import type { LanguageServiceContext } from "@volar/language-service";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { URI } from "vscode-uri";

const nolaServicePlugin = createNolaServicePlugin(ts, { sourceRoot: "/proj" });

function snap(text: string) {
  return {
    getText: (a: number, b: number) => text.slice(a, b),
    getLength: () => text.length,
    getChangeRange: () => undefined,
  };
}

const BROKEN = "const p = ..5;\nconst ok = ..`y`<string>;\n";

describe("nolaServicePlugin", () => {
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

// Volar runs diagnostics plugins against EVERY code of a script whose mappings
// admit verification — the root (the .tsi source itself, id "root") included.
// nola-native diagnostics carry SOURCE offsets, so the root document is where
// they belong: an identity mapping, no translation, and no dependence on the
// embedded mappings — which, after a bailed parse, describe an OLDER text
// (the parse error sat past their extent and was dropped).
describe("nolaServicePlugin: root-document diagnostics", () => {
  const plugin = createNolaLanguagePlugin<URI>((uri) => uri.fsPath.replace(/\\/g, "/"));
  const sourceUri = URI.file("/proj/a.tsi");

  function contextFor(root: NolaVirtualCode): LanguageServiceContext {
    const embedded = root.embeddedCodes[0];
    const codes = new Map([
      [root.id, root],
      [embedded.id, embedded],
    ]);
    return {
      decodeEmbeddedDocumentUri: (uri: URI) =>
        uri.scheme === "volar-embedded" ? ([sourceUri, uri.authority] as [URI, string]) : undefined,
      language: {
        scripts: {
          get: (id: URI) => (id.toString() === sourceUri.toString() ? { generated: { root, embeddedCodes: codes } } : undefined),
        },
        maps: { get: (code: { mappings: unknown[] }) => defaultMapperFactory(code.mappings as never) },
      },
    } as unknown as LanguageServiceContext;
  }

  function docFor(id: string, languageId: string, text: string) {
    return {
      uri: `volar-embedded://${id}/a.tsi`,
      languageId,
      positionAt: (offset: number) => {
        const before = text.slice(0, offset);
        return { line: before.split("\n").length - 1, character: offset - (before.lastIndexOf("\n") + 1) };
      },
    } as never;
  }

  type Diag = { code?: string | number; source?: string; range: { start: { line: number; character: number } } };

  it("publishes parse diagnostics on the root document at source positions, and not on the embedded one", () => {
    const root = plugin.createVirtualCode?.(sourceUri, "nola", snap(BROKEN), {} as never);
    if (!(root instanceof NolaVirtualCode)) throw new Error("no virtual code");
    const instance = nolaServicePlugin.create(contextFor(root));
    const onRoot = (instance.provideDiagnostics?.(docFor("root", "nola", BROKEN), {} as never) ?? []) as Diag[];
    const d = onRoot.find((x) => x.code === "NOLA1005");
    expect(d).toBeDefined();
    expect(d?.source).toBe("nola");
    // NOLA1005 is raised at the token after the sigil
    expect(d?.range.start).toEqual({ line: 0, character: BROKEN.indexOf("..5") + 2 });
    const embeddedText = root.embeddedCodes[0].snapshot.getText(0, root.embeddedCodes[0].snapshot.getLength());
    const onEmbedded = (instance.provideDiagnostics?.(docFor("ts", "typescript", embeddedText), {} as never) ?? []) as Diag[];
    expect(onEmbedded.filter((x) => x.code === "NOLA1005")).toEqual([]);
  });

  it("a bailed snapshot still reports its parse error at the right place", () => {
    const good = "const i = ..`x`<string>;\n";
    const bails = "const i = ..`x`<string>;\nfoo(\n";
    const root = plugin.createVirtualCode?.(sourceUri, "nola", snap(good), {} as never);
    if (!(root instanceof NolaVirtualCode)) throw new Error("no virtual code");
    const updated = plugin.updateVirtualCode?.(sourceUri, root, snap(bails), {} as never);
    const current = updated instanceof NolaVirtualCode ? updated : root;
    expect(current.stale).toBe(true);
    const instance = nolaServicePlugin.create(contextFor(current));
    const onRoot = (instance.provideDiagnostics?.(docFor("root", "nola", bails), {} as never) ?? []) as Diag[];
    expect(onRoot.map((x) => x.code)).toEqual(["NOLA1001"]);
    // the unclosed call is reported at the end of the file — past the extent
    // of the last-good mappings, where the embedded route lost it
    expect(onRoot[0]?.range.start).toEqual({ line: 2, character: 0 });
  });
});
