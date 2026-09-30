// The language server wraps volar-service-typescript's plugins so the names
// the lowering generates never reach the author on a .tsi: TS6133 on an
// unused `__nola_ctx_N` (an item no ask sees) and identifier completion's
// `__nola…` / `__frame`. A document not embedded in a .tsi is left alone.
import { hideGeneratedNames } from "@nola-lang/language-server";
import type { LanguageServiceContext, LanguageServicePlugin } from "@volar/language-service";
import { describe, expect, it } from "vitest";
import { URI } from "vscode-uri";

// Volar's own encoding of an embedded document's URI (languageService.js).
const embedded = (source: string) => `volar-embedded-content://main/${encodeURIComponent(source)}`;
const context = {
  decodeEmbeddedDocumentUri: (uri: URI) =>
    uri.scheme === "volar-embedded-content"
      ? [URI.parse(decodeURIComponent(uri.path.slice(1))), decodeURIComponent(uri.authority)]
      : undefined,
} as unknown as LanguageServiceContext;
const doc = (uri: string) => ({ uri }) as never;
const token = {} as never;

const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
const unused = (name: string) => ({
  range,
  severity: 4 as const,
  source: "ts",
  code: 6133,
  message: `'${name}' is declared but its value is never read.`,
  tags: [1 as const],
});
const LABELS = ["__nola", "__frame", "__nola_module_ctx", "__nola_type_$1", "__nola_ctx_1", "oncall", "console"];

const typescriptPlugin: LanguageServicePlugin = {
  name: "typescript-semantic",
  capabilities: {},
  create: () => ({
    provideDiagnostics: async () => [
      unused("__nola_ctx_1"),
      unused("foo"),
      { range, severity: 1, source: "nola", code: "NOLA2002", message: "'__nola_x' is not a TS code" },
    ],
    provideCompletionItems: () => ({
      isIncomplete: true,
      itemDefaults: { commitCharacters: ["."] },
      items: LABELS.map((label) => ({ label })),
    }),
  }),
};

describe("language server: generated names", () => {
  const instance = hideGeneratedNames(typescriptPlugin).create(context);

  it("drops TS6133 on a generated name from a .tsi's diagnostics and keeps the rest", async () => {
    const onTsi = await instance.provideDiagnostics?.(doc(embedded("file:///p/src/a.tsi")), token);
    expect(onTsi?.map((d) => d.message)).toEqual([
      "'foo' is declared but its value is never read.",
      "'__nola_x' is not a TS code",
    ]);
    const onTs = await instance.provideDiagnostics?.(doc("file:///p/src/b.ts"), token);
    expect(onTs).toHaveLength(3);
  });

  it("drops generated names from a .tsi's completion list; isIncomplete and itemDefaults stay", async () => {
    const complete = (uri: string) => instance.provideCompletionItems?.(doc(uri), range.start, { triggerKind: 1 }, token);
    const onTsi = await complete(embedded("file:///p/src/a.tsi"));
    expect(onTsi?.items.map((i) => i.label)).toEqual(["oncall", "console"]);
    expect(onTsi?.isIncomplete).toBe(true);
    expect(onTsi?.itemDefaults).toEqual({ commitCharacters: ["."] });
    const onTs = await complete("file:///p/src/b.ts");
    expect(onTs?.items).toHaveLength(LABELS.length);
  });

  it("keeps the plugin's name and capabilities", () => {
    const wrapped = hideGeneratedNames(typescriptPlugin);
    expect(wrapped.name).toBe(typescriptPlugin.name);
    expect(wrapped.capabilities).toBe(typescriptPlugin.capabilities);
  });
});
