import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decorateHostWithCompanions } from "@nola-lang/typescript-plugin";
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

describe("decorateHostWithCompanions", () => {
  it("resolves *.nola.js to a synthetic script derived from the LIVE snapshot", () => {
    const dir = mkdtempSync(join(tmpdir(), "nola-tsplugin-")).replace(/\\/g, "/");
    const models = `${dir}/models.ts`;
    writeFileSync(models, "export interface Person { name: string }\n");
    const files = new Map([[models, { text: "export interface Person { name: string }\n", version: 1 }]]);
    const host = makeHost(dir, files);
    decorateHostWithCompanions(ts, host, { sourceRoot: dir });

    const resolved = host.resolveModuleNameLiterals?.(
      [{ text: "./models.nola.js" } as ts.StringLiteralLike],
      `${dir}/report.tsi.ts`,
      undefined,
      host.getCompilationSettings(),
      undefined as never,
      undefined,
    );
    const fileName = resolved?.[0]?.resolvedModule?.resolvedFileName?.replace(/\\/g, "/");
    expect(fileName).toBe(`${dir}/models.nola.ts`);
    expect(host.fileExists?.(fileName as string)).toBe(true);

    const snap1 = host.getScriptSnapshot?.(fileName as string);
    const text1 = snap1?.getText(0, snap1.getLength()) ?? "";
    expect(text1).toContain("__nola_type_Person as Person");
    const v1 = host.getScriptVersion(fileName as string);

    // live edit: bump the source snapshot -> companion version and content follow
    files.set(models, { text: "export interface Person { name: string; age: number }\n", version: 2 });
    const v2 = host.getScriptVersion(fileName as string);
    expect(v2).not.toBe(v1);
    const snap2 = host.getScriptSnapshot?.(fileName as string);
    expect(snap2?.getText(0, snap2.getLength())).toContain("age");
  });
});
