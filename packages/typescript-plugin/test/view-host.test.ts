import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decorateHostWithViews } from "@nola-lang/typescript-plugin";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function makeHost(rootDir: string, files: Map<string, { text: string; version: number }>): ts.LanguageServiceHost {
  return {
    getCompilationSettings: () => ({
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
    }),
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: (f) => String(files.get(f.replace(/\\/g, "/"))?.version ?? 0),
    getScriptSnapshot: (f) => {
      const entry = files.get(f.replace(/\\/g, "/"));
      if (entry) return ts.ScriptSnapshot.fromString(entry.text);
      if (ts.sys.fileExists(f)) return ts.ScriptSnapshot.fromString(ts.sys.readFile(f) ?? "");
      return undefined;
    },
    getCurrentDirectory: () => rootDir,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => files.has(f.replace(/\\/g, "/")) || ts.sys.fileExists(f),
    readFile: (f) => files.get(f.replace(/\\/g, "/"))?.text ?? ts.sys.readFile(f),
  };
}

const resolveOne = (host: ts.LanguageServiceHost, text: string, containing: string) =>
  host.resolveModuleNameLiterals?.(
    [{ text } as ts.StringLiteralLike],
    containing,
    undefined,
    host.getCompilationSettings(),
    undefined as never,
    undefined,
  )?.[0]?.resolvedModule;

describe("decorateHostWithViews", () => {
  it("resolves a missing ./models.tsi to a synthetic view derived from the LIVE snapshot", () => {
    const dir = mkdtempSync(join(tmpdir(), "nola-tsplugin-")).replace(/\\/g, "/");
    const models = `${dir}/models.ts`;
    writeFileSync(models, "export interface Person { name: string }\n");
    const files = new Map([[models, { text: "export interface Person { name: string }\n", version: 1 }]]);
    const host = makeHost(dir, files);
    decorateHostWithViews(ts, host, { sourceRoot: dir });

    const fileName = resolveOne(host, "./models.tsi", `${dir}/report.tsi.ts`)?.resolvedFileName?.replace(/\\/g, "/");
    expect(fileName).toBe(`${dir}/models.tsi.ts`);
    expect(host.fileExists?.(fileName as string)).toBe(true);

    const snap1 = host.getScriptSnapshot?.(fileName as string);
    const text1 = snap1?.getText(0, snap1.getLength()) ?? "";
    expect(text1).toContain('export type Person = import("./models.js").Person;');
    expect(text1).toContain("export const Person =");
    const v1 = host.getScriptVersion(fileName as string);

    // live edit: bump the source snapshot -> view version and content follow
    files.set(models, { text: "export interface Person { name: string; age: number }\n", version: 2 });
    expect(host.getScriptVersion(fileName as string)).not.toBe(v1);
    // the view is phase-1 text (member names live in the checker, not the text): a fresh snapshot, same shape
    const snap2 = host.getScriptSnapshot?.(fileName as string);
    expect(snap2).not.toBe(snap1);
    expect(snap2?.getText(0, snap2.getLength())).toContain("export const Person =");
  });

  it("a .tsi the prior chain already resolved is left alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "nola-tsplugin-")).replace(/\\/g, "/");
    const host = makeHost(dir, new Map());
    host.resolveModuleNameLiterals = (literals) =>
      literals.map(() => ({
        resolvedModule: { resolvedFileName: `${dir}/shapes.tsi`, extension: ts.Extension.Ts, isExternalLibraryImport: false },
      }));
    decorateHostWithViews(ts, host, { sourceRoot: dir });
    expect(resolveOne(host, "./shapes.tsi", `${dir}/main.ts`)?.resolvedFileName).toBe(`${dir}/shapes.tsi`);
  });

  it("a .tsi with no type source next to it stays unresolved (TS2307 territory)", () => {
    const dir = mkdtempSync(join(tmpdir(), "nola-tsplugin-")).replace(/\\/g, "/");
    const host = makeHost(dir, new Map());
    decorateHostWithViews(ts, host, { sourceRoot: dir });
    expect(resolveOne(host, "./missing.tsi", `${dir}/main.ts`)).toBeUndefined();
  });
});
