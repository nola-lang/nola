import { describe, expect, it } from "vitest";
import { URI } from "vscode-uri";
import { type DocumentLookup, decorateDocumentsForCaseInsensitiveFs } from "../src/document-lookup.js";

interface Doc {
  uri: string;
  text: string;
}

/** Volar's shape: an exact-string lookup over the open documents plus open/close events. */
function volarLikeDocuments(docs: Doc[], withEvents = true) {
  const byUri = new Map(docs.map((d) => [URI.parse(d.uri).toString(), d]));
  const openListeners: ((e: { document: Doc }) => void)[] = [];
  const closeListeners: ((e: { document: Doc }) => void)[] = [];
  let allCalls = 0;
  const documents: DocumentLookup<Doc> = {
    get: (uri) => byUri.get(uri.toString()),
    all: () => {
      allCalls++;
      return [...byUri.values()];
    },
    ...(withEvents
      ? {
          onDidOpen: (l: (e: { document: Doc }) => void) => openListeners.push(l),
          onDidClose: (l: (e: { document: Doc }) => void) => closeListeners.push(l),
        }
      : {}),
  };
  return {
    documents,
    allCalls: () => allCalls,
    open(doc: Doc) {
      byUri.set(URI.parse(doc.uri).toString(), doc);
      for (const l of openListeners) l({ document: doc });
    },
    close(doc: Doc) {
      byUri.delete(URI.parse(doc.uri).toString());
      for (const l of closeListeners) l({ document: doc });
    },
  };
}

describe("decorateDocumentsForCaseInsensitiveFs", () => {
  const open: Doc = { uri: "file:///d%3A/Work/App/src/main.tsi", text: "edited" };

  it("keeps the exact lookup first", () => {
    const { documents } = volarLikeDocuments([open]);
    decorateDocumentsForCaseInsensitiveFs(documents);
    expect(documents.get(URI.parse("file:///d%3A/Work/App/src/main.tsi"))).toBe(open);
  });

  it("finds the open document under the tsconfig's differently cased spelling", () => {
    const { documents } = volarLikeDocuments([open]);
    expect(documents.get(URI.file("d:/work/App/src/main.tsi"))).toBeUndefined();
    decorateDocumentsForCaseInsensitiveFs(documents);
    expect(documents.get(URI.file("d:/work/App/src/main.tsi"))).toBe(open);
    expect(documents.get(URI.parse("file:///D:/WORK/APP/SRC/MAIN.TSI"))).toBe(open);
  });

  it("still misses a file that is not open", () => {
    const { documents } = volarLikeDocuments([open]);
    decorateDocumentsForCaseInsensitiveFs(documents);
    expect(documents.get(URI.file("d:/work/App/src/other.tsi"))).toBeUndefined();
  });

  it("tracks documents opened and closed after the decoration", () => {
    const fixture = volarLikeDocuments([]);
    decorateDocumentsForCaseInsensitiveFs(fixture.documents);
    expect(fixture.documents.get(URI.file("d:/work/app/src/main.tsi"))).toBeUndefined();
    fixture.open(open);
    expect(fixture.documents.get(URI.file("d:/work/app/src/main.tsi"))).toBe(open);
    fixture.close(open);
    expect(fixture.documents.get(URI.file("d:/work/app/src/main.tsi"))).toBeUndefined();
  });

  it("a miss does not enumerate the open documents once the index exists", () => {
    // this lookup sits under every TypeScript host probe, and nearly all of them
    // miss (lib files, node_modules, candidates that do not exist)
    const fixture = volarLikeDocuments([open]);
    decorateDocumentsForCaseInsensitiveFs(fixture.documents);
    fixture.documents.get(URI.file("d:/lib/lib.dom.d.ts"));
    const after = fixture.allCalls();
    for (let i = 0; i < 1000; i++) fixture.documents.get(URI.file(`d:/proj/node_modules/pkg/${i}.d.ts`));
    expect(fixture.allCalls()).toBe(after);
    expect(after).toBe(1);
  });

  it("without open/close events it rebuilds the index on each miss and stays correct", () => {
    const fixture = volarLikeDocuments([], false);
    decorateDocumentsForCaseInsensitiveFs(fixture.documents);
    fixture.open(open);
    expect(fixture.documents.get(URI.file("d:/work/app/src/main.tsi"))).toBe(open);
  });
});
