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

/** The document formatted through the plugin, the edits applied; `lines` restricts the request to those lines. */
async function formatSource(content: string, options: { tabSize?: number; insertSpaces?: boolean; lines?: [number, number] } = {}) {
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
  const range = options.lines
    ? { start: { line: options.lines[0], character: 0 }, end: { line: options.lines[1] + 1, character: 0 } }
    : { start: document.positionAt(0), end: document.positionAt(content.length) };
  const edits = ((await instance.provideDocumentFormattingEdits?.(
    document as never,
    range,
    { tabSize: options.tabSize ?? 2, insertSpaces: options.insertSpaces ?? true },
    undefined,
    {} as never,
  )) ?? []) as Array<{
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    newText: string;
  }>;
  let formatted = content;
  for (const edit of [...edits].sort((a, b) => document.offsetAt(b.range.start) - document.offsetAt(a.range.start))) {
    formatted =
      formatted.slice(0, document.offsetAt(edit.range.start)) + edit.newText + formatted.slice(document.offsetAt(edit.range.end));
  }
  return formatted;
}

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
    const formatted = await formatSource(content);
    expect(formatted).toContain("\n  for (const c of q) {");
    expect(formatted).toContain("  const s = ask ..`n`<string>;");
  });
});

// An ask sequence is not TypeScript: its formatter reads `` ask `x` [a] `y` ``
// as tagged templates and an index — it deleted the spaces between the parts
// and set a part on its own line at the statement's column (2026-10-15). The
// plugin keeps TypeScript's edits only inside a text, a value or a list entry
// and lays the sequence out itself: one space between the tokens on a line,
// the colon and `<T>` glued to the last part, one space after the colon; a
// part, a list's `]` or the type on its own line one level in from the ask's
// line, a list's entries two levels in; a comment in a gap leaves the gap
// alone (ask-sequence spec §3.12).
describe("nolaServicePlugin: an ask sequence's layout", () => {
  it("leaves a list spanning lines and the type on its own line as written", async () => {
    const content = [
      "const files = ask `the files on disc D that belong to a US visa application` [",
      "    searchFiles, readFile",
      "  ] `dsa`  ",
      "  : string[];",
      "",
    ].join("\n");
    expect(await formatSource(content)).toBe(content);
  });

  it("indents a part on its own line one level in and glues the colon", async () => {
    const content = [
      "const files = ask `the files on disc D that belong to a US visa application`",
      "  [searchFiles, readFile]",
      "  `dsa`    : string[];",
      "",
    ].join("\n");
    expect(await formatSource(content)).toBe(
      [
        "const files = ask `the files on disc D that belong to a US visa application`",
        "  [searchFiles, readFile]",
        "  `dsa`: string[];",
        "",
      ].join("\n"),
    );
  });

  it("one space between the tokens on a line: the head, the parts, a list's entries; the type glued", async () => {
    expect(await formatSource("const a = ask with  gpt  `x`  (user)  `y`  : string;\n")).toBe("const a = ask with gpt `x` (user) `y`: string;\n");
    expect(await formatSource("const b = ..`x`  [ a , fs.readFile ,...more ]  <string>;\n")).toBe("const b = ..`x` [a, fs.readFile, ...more]<string>;\n");
    expect(await formatSource("const c = createTicket(`title` : string, 2);\n")).toBe("const c = createTicket(`title`: string, 2);\n");
    expect(await formatSource("const d = ask   `one`;\n")).toBe("const d = ask `one`;\n");
  });

  it("lays a list that spans lines out from the ask's line: entries two levels in, the `]` and the type one", async () => {
    const content = [
      "infer function f() {",
      "  const files = ask `x` [",
      "searchFiles,",
      "        readFile",
      "      ]",
      ": string[];",
      "  return files;",
      "}",
      "",
    ].join("\n");
    expect(await formatSource(content)).toBe(
      [
        "infer function f() {",
        "  const files = ask `x` [",
        "      searchFiles,",
        "      readFile",
        "    ]",
        "    : string[];",
        "  return files;",
        "}",
        "",
      ].join("\n"),
    );
    // tabs, when the editor indents with them
    const tabbed = ["infer function f() {", "\tconst n = ask `x`", "<number>;", "\treturn n;", "}", ""].join("\n");
    expect(await formatSource(tabbed, { insertSpaces: false, tabSize: 4 })).toBe(
      ["infer function f() {", "\tconst n = ask `x`", "\t\t<number>;", "\treturn n;", "}", ""].join("\n"),
    );
  });

  it("the operand on the line after `ask`, and a blank line between parts, keep their line breaks", async () => {
    expect(await formatSource("const x = ask\n`p`: number;\n")).toBe("const x = ask\n  `p`: number;\n");
    expect(await formatSource("const y = ask `p`\n\n[a]: number;\n")).toBe("const y = ask `p`\n\n  [a]: number;\n");
  });

  it("keeps TypeScript's edits inside a value and leaves a gap with a comment alone", async () => {
    expect(await formatSource("const r = ask `use` pick( user ) `go`: Result;\n")).toBe("const r = ask `use` pick(user) `go`: Result;\n");
    // the gap with the comment stays; the one after the list is laid out
    expect(await formatSource("const r = ask `use` /* the tools */  [a]  : Result;\n")).toBe("const r = ask `use` /* the tools */  [a]: Result;\n");
  });

  it("a request for some lines touches only those lines", async () => {
    const content = ["const files = ask `the files`", "[searchFiles, readFile]", "`dsa`    : string[];", "const  n = 1;", ""].join("\n");
    expect(await formatSource(content, { lines: [3, 3] })).toBe(
      ["const files = ask `the files`", "[searchFiles, readFile]", "`dsa`    : string[];", "const n = 1;", ""].join("\n"),
    );
  });
});

describe("nolaServicePlugin: documents", () => {

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
