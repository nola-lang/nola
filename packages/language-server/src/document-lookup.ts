import { URI } from "vscode-uri";

/** The slice of Volar's `server.documents` the decoration touches. */
export interface DocumentLookup<TDocument extends { uri: string }> {
  get(uri: URI): TDocument | undefined;
  all(): TDocument[];
  onDidOpen?(listener: (event: { document: TDocument }) => void): unknown;
  onDidClose?(listener: (event: { document: TDocument }) => void): unknown;
}

/**
 * Volar looks a synced (open) document up by the EXACT string of its URI,
 * while everything else about a file on a case-insensitive file system is
 * case-insensitive: the script map (`createUriMap(sys.useCaseSensitiveFileNames)`),
 * TypeScript's program, and the project's own matching of unsaved files
 * against `include`. So when the editor's URI for a file and the tsconfig's
 * spelling of it differ only in case — a folder opened as `d:/work/App` while
 * the file was opened as `d:/Work/App/src/main.tsi`, or the other way round —
 * the same file is two root names for TypeScript, and each sync of the
 * project asks the ONE shared script for a snapshot under both spellings: the
 * editor's finds the open document, the other one misses and falls back to
 * the file ON DISK. The script's snapshot then flips between the editor's
 * text and the saved text on every host call — the program TypeScript answers
 * from is one autosave behind the text the mappings describe. What the user
 * saw: a `.` typed at the end of `console` (or inside a prompt) answered with
 * the whole global scope, TS2304 and derivation errors flashing under `<T>`
 * for the second or two until autosave wrote the file.
 *
 * Applied when the tsdk reports a case-insensitive file system, this makes the
 * lookup fall back to a case-insensitive match over the open documents. The
 * exact lookup stays first, so nothing changes where spellings agree.
 *
 * The fallback is an index, not a scan: this `get` sits under every script
 * lookup Volar makes for TypeScript — every fileExists / readFile /
 * getScriptVersion of every file in the program, tens of thousands per
 * project sync — and almost all of them MISS (lib files, node_modules, probed
 * candidates that do not exist). The index is built once from the open
 * documents and kept current from the open/close events, so a miss costs one
 * lowercase of the asked URI and one Map probe.
 */
export function decorateDocumentsForCaseInsensitiveFs<TDocument extends { uri: string }>(
  documents: DocumentLookup<TDocument>,
): void {
  const prior = documents.get.bind(documents);
  const keys = new WeakMap<TDocument, string>();
  const keyOf = (document: TDocument): string => {
    let key = keys.get(document);
    if (key === undefined) {
      key = URI.parse(document.uri).toString().toLowerCase();
      keys.set(document, key);
    }
    return key;
  };
  // Without the events the index cannot be kept current, so it is rebuilt on
  // every miss (the scan this replaces); with them it is built once.
  const live = Boolean(documents.onDidOpen && documents.onDidClose);
  let index: Map<string, TDocument> | undefined;
  const rebuild = (): Map<string, TDocument> => {
    const next = new Map<string, TDocument>();
    for (const document of documents.all()) next.set(keyOf(document), document);
    index = next;
    return next;
  };
  documents.onDidOpen?.(({ document }) => {
    index?.set(keyOf(document), document);
  });
  documents.onDidClose?.(({ document }) => {
    index?.delete(keyOf(document));
  });
  documents.get = (uri) => {
    const exact = prior(uri);
    if (exact) return exact;
    const table = live ? (index ?? rebuild()) : rebuild();
    return table.get(uri.toString().toLowerCase());
  };
}
