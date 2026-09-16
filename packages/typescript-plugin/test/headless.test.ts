// The Track 2 exit criterion (spec §6d): a real ts.LanguageService, decorated
// by Volar + the view host, over an in-memory project — tsserver-equivalent
// behavior with no editor.
import { RUNTIME_AMBIENT_STUB } from "@nola-lang/compiler";
import { createNolaLanguagePlugin } from "@nola-lang/language-core";
import {
  decorateHostHideShadowedDeclarations,
  decorateHostWithViews,
  decorateLanguageServiceWithDerivationDiagnostics,
} from "@nola-lang/typescript-plugin";
import { createLanguage } from "@volar/language-core";
import { createProxyLanguageService, decorateLanguageServiceHost, resolveFileLanguageId } from "@volar/typescript";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = "/proj";

interface Entry {
  text: string;
  version: number;
  snapshot?: ts.IScriptSnapshot;
}

const MODELS_V1 = "export interface Person { name: string; manager?: Person; home: { city: string } }\n";
const MODELS_V2 =
  "export interface Person { name: string; manager?: Person; home: { city: string }; nickname: string }\n";
const REPORT = [
  'import type { Person } from "./models.js";',
  "export infer function extractPerson(text: string) {",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${...} in .tsi fixture source
  "  const person = ask ..`the person described in: ${text}`<Person>;",
  "  return person;",
  "}",
  "",
].join("\n");
const MAIN = [
  'import { extractPerson } from "./report.tsi";',
  "",
  "export async function run(): Promise<void> {",
  '  const p = await extractPerson("x");',
  "  const city: string = p.home.city;",
  "  const nick: string = p.nickname;",
  "  console.log(city, nick);",
  "}",
  "",
].join("\n");
const BAD_TSN = [
  "export infer function go(q: string) {",
  "  const s: string = ask ..`n`<number>;",
  "  return s;",
  "}",
  "",
].join("\n");

// A plain .ts importing `./models.tsi` with NO such file: the view of models.ts
// (emit 14) — the interface AND its InferType value under one name.
const SCHEMA = [
  'import { Person } from "./models.tsi";',
  "export const s = Person.toJsonSchema();",
  "export const bad: number = Person;",
  "",
].join("\n");
// An exported type gets a value inserted right after it; positions after the
// insert must still map to source lines.
const VALUES = "export type P = { x: number };\nconst wrong: string = 1;\n";
// Underivable types: phase-1 output is inert, so the lazy derivation pass on
// getSemanticDiagnostics reports them (emit 15), mapped to the source ranges.
const EXOTIC = "export infer function f(.x: Map<string, number>) {\n  return ask ..`y`<Set<string>>;\n}\n";

const files = new Map<string, Entry>();
let proxy: ts.LanguageService;

function setFile(name: string, text: string): void {
  const existing = files.get(name);
  files.set(name, { text, version: (existing?.version ?? 0) + 1 });
}

function snapshotFor(entry: Entry): ts.IScriptSnapshot {
  entry.snapshot ??= ts.ScriptSnapshot.fromString(entry.text);
  return entry.snapshot;
}

function norm(p: string): string {
  return p.replace(/\\/g, "/");
}

beforeAll(() => {
  setFile(`${ROOT}/models.ts`, MODELS_V1);
  setFile(`${ROOT}/report.tsi`, REPORT);
  setFile(`${ROOT}/main.ts`, MAIN);
  setFile(`${ROOT}/bad.tsi`, BAD_TSN);
  setFile(`${ROOT}/schema.ts`, SCHEMA);
  setFile(`${ROOT}/values.tsi`, VALUES);
  setFile(`${ROOT}/exotic.tsi`, EXOTIC);
  setFile("/stubs/runtime.d.ts", RUNTIME_AMBIENT_STUB);
  // A stale on-disk build artifact (the old adjacent-declaration emit). With
  // allowArbitraryExtensions TS would resolve `./report.tsi` to it FIRST,
  // shadowing the live virtual .tsi — the hide decoration must defeat it.
  setFile(`${ROOT}/report.d.tsi.ts`, "export declare function extractPerson(text: string): Promise<number>;\n");

  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    // tsserver sets this implicitly when a plugin registers extraFileExtensions;
    // a headless host must set it or .tsi root files are rejected.
    allowNonTsExtensions: true,
    // real projects importing .tsi from plain TS set this (see examples)
    allowArbitraryExtensions: true,
    baseUrl: "/",
    paths: { "@nola-lang/runtime": ["/stubs/runtime.d.ts"] },
  };

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => [
      `${ROOT}/main.ts`,
      `${ROOT}/report.tsi`,
      `${ROOT}/bad.tsi`,
      `${ROOT}/schema.ts`,
      `${ROOT}/values.tsi`,
      `${ROOT}/exotic.tsi`,
    ],
    getScriptVersion: (f) => String(files.get(norm(f))?.version ?? 0),
    getScriptSnapshot: (f) => {
      const entry = files.get(norm(f));
      if (entry) return snapshotFor(entry);
      if (ts.sys.fileExists(f)) return ts.ScriptSnapshot.fromString(ts.sys.readFile(f) ?? "");
      return undefined;
    },
    getCurrentDirectory: () => ROOT,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => files.has(norm(f)) || ts.sys.fileExists(f),
    readFile: (f) => files.get(norm(f))?.text ?? ts.sys.readFile(f),
    // tsserver's Project always implements this; Volar decorates it only when
    // present (its own `.tsi` resolver), and the view host wraps Volar's — so a
    // faithful headless stack needs the base resolver here too.
    resolveModuleNameLiterals: (literals, containingFile, _redirected, opts) =>
      literals.map((lit) => ({
        resolvedModule: ts.resolveModuleName(lit.text, containingFile, opts, {
          fileExists: (f) => host.fileExists?.(f) ?? false,
          readFile: (f) => host.readFile?.(f),
        }).resolvedModule,
      })),
    directoryExists: (d) => {
      const key = `${norm(d).replace(/\/+$/, "")}/`;
      for (const f of files.keys()) if (f.startsWith(key)) return true;
      return ts.sys.directoryExists(d);
    },
  };

  // Order matches the tsserver plugin: shadowed-declaration hiding innermost,
  // then Volar's decoration (owns .tsi resolution into virtual scripts), then
  // the view host OUTERMOST — it answers only the `.tsi` literals Volar left
  // unresolved (no such Nola file), with the view of the plain module.
  decorateHostHideShadowedDeclarations(ts, host);

  const nolaPlugin = createNolaLanguagePlugin<string>((fileName) => fileName, { sourceRoot: ROOT });
  const language = createLanguage<string>(
    [nolaPlugin, { getLanguageId: (fileName) => resolveFileLanguageId(fileName) }],
    new Map(),
    (fileName) => {
      const entry = files.get(norm(fileName));
      if (entry) {
        language.scripts.set(fileName, snapshotFor(entry));
      } else if (ts.sys.fileExists(fileName)) {
        language.scripts.set(fileName, ts.ScriptSnapshot.fromString(ts.sys.readFile(fileName) ?? ""));
      } else {
        language.scripts.delete(fileName);
      }
    },
  );
  decorateLanguageServiceHost(ts, language, host);
  decorateHostWithViews(ts, host, { sourceRoot: ROOT });

  const base = ts.createLanguageService(host);
  // the tsserver plugin decorates the INNER service the same way, before Volar proxies it
  decorateLanguageServiceWithDerivationDiagnostics(ts, base, () => language, { sourceRoot: ROOT });
  const proxied = createProxyLanguageService(base);
  proxied.initialize(language);
  proxy = proxied.proxy;
});

describe("headless editor stack (tsserver-equivalent)", () => {
  it("cross-boundary types: main.ts sees Person through the .tsi boundary", () => {
    const main = files.get(`${ROOT}/main.ts`) as Entry;
    const pos = main.text.indexOf("p.home");
    const info = proxy.getQuickInfoAtPosition(`${ROOT}/main.ts`, pos);
    const rendered = ts.displayPartsToString(info?.displayParts);
    expect(rendered).toContain("Person");
  });

  it("go-to-definition from main.ts lands in report.tsi (mapped back)", () => {
    const main = files.get(`${ROOT}/main.ts`) as Entry;
    const pos = main.text.indexOf("extractPerson(");
    const defs = proxy.getDefinitionAtPosition(`${ROOT}/main.ts`, pos);
    expect(defs?.length).toBeGreaterThan(0);
    const def = defs?.[0];
    expect(def?.fileName.endsWith(".tsi")).toBe(true);
    const report = files.get(`${ROOT}/report.tsi`) as Entry;
    const defText = report.text.slice(
      def?.textSpan.start ?? 0,
      (def?.textSpan.start ?? 0) + (def?.textSpan.length ?? 0),
    );
    expect(defText).toBe("extractPerson");
  });

  it("diagnostics map into .tsi source coordinates", () => {
    const diags = proxy.getSemanticDiagnostics(`${ROOT}/bad.tsi`);
    const mismatch = diags.find((d) => d.code === 2322);
    expect(mismatch).toBeDefined();
    const bad = files.get(`${ROOT}/bad.tsi`) as Entry;
    const start = mismatch?.start ?? -1;
    expect(start).toBeGreaterThanOrEqual(0);
    expect(start).toBeLessThan(bad.text.length);
    // the mapped position sits on the misused declaration line
    const line = bad.text.slice(0, start).split("\n").length;
    expect(line).toBe(2);
  });

  it("plain .ts importing ./models.tsi (no such file) gets the view: value typed, wrong assignment flagged", () => {
    const diags = proxy.getSemanticDiagnostics(`${ROOT}/schema.ts`);
    expect(diags.map((d) => d.code)).toEqual([2322]);
    const pos = (files.get(`${ROOT}/schema.ts`) as Entry).text.indexOf("Person.toJsonSchema");
    const info = ts.displayPartsToString(proxy.getQuickInfoAtPosition(`${ROOT}/schema.ts`, pos)?.displayParts);
    expect(info).toContain("InferType<Person>");
  });

  it("positions after an inserted type value still map to the source line", () => {
    const diags = proxy.getSemanticDiagnostics(`${ROOT}/values.tsi`);
    const mismatch = diags.find((d) => d.code === 2322);
    expect(mismatch).toBeDefined();
    const text = (files.get(`${ROOT}/values.tsi`) as Entry).text;
    const start = mismatch?.start ?? -1;
    expect(text.slice(0, start).split("\n").length).toBe(2);
    expect(text.slice(start, start + "wrong".length)).toBe("wrong");
  });

  it("lazy derivation diagnostics: NOLA2002 at the extractor <T>, NOLA2008 at the annotation, in source coordinates", () => {
    const diags = proxy.getSemanticDiagnostics(`${ROOT}/exotic.tsi`).filter((d) => d.source === "nola");
    expect(diags.map((d) => d.code).sort()).toEqual([2002, 2008]);
    const text = (files.get(`${ROOT}/exotic.tsi`) as Entry).text;
    const at = (d: ts.Diagnostic | undefined) => text.slice(d?.start ?? -1, (d?.start ?? 0) + (d?.length ?? 0));
    const extract = diags.find((d) => d.code === 2002);
    expect(at(extract)).toBe("Set<string>");
    expect(String(extract?.messageText)).toContain("NOLA2002");
    expect(at(diags.find((d) => d.code === 2008))).toBe("Map<string, number>");
  });

  it("view freshness: an unsaved edit to models.ts propagates", () => {
    // MODELS_V1 has no `nickname` -> main.ts's `p.nickname` errors
    const before = proxy.getSemanticDiagnostics(`${ROOT}/main.ts`);
    expect(before.some((d) => d.code === 2339)).toBe(true);

    setFile(`${ROOT}/models.ts`, MODELS_V2); // in-memory bump, no disk involved
    const after = proxy.getSemanticDiagnostics(`${ROOT}/main.ts`);
    expect(after.filter((d) => d.code === 2339)).toEqual([]);
  });

  it("last-good: an irrecoverable mid-edit keeps main.ts typechecking", () => {
    // An unterminated extractor template bails even under tolerant parsing
    // (Babel throws non-recoverably at EOF inside the template) — the exact
    // mid-keystroke state last-good exists for.
    setFile(
      `${ROOT}/report.tsi`,
      "export infer function extractPerson(text: string) {\n  const person = ask ..`the per",
    );
    const diags = proxy.getSemanticDiagnostics(`${ROOT}/main.ts`);
    // extractPerson must still resolve with its previous shape: no missing
    // module (2307) and no missing export (2305/2339 on the import).
    expect(diags.filter((d) => d.code === 2307 || d.code === 2305)).toEqual([]);
    const main = files.get(`${ROOT}/main.ts`) as Entry;
    const pos = main.text.indexOf("p.home");
    const info = proxy.getQuickInfoAtPosition(`${ROOT}/main.ts`, pos);
    expect(ts.displayPartsToString(info?.displayParts)).toContain("Person");
  });
});
