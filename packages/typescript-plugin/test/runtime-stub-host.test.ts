// When `@nola-lang/runtime` is NOT resolvable from a project — the window
// between `npm create nola` and `npm install`, or a bare .tsi opened on its
// own — the lowered code's appendix import fails silently (TS2307 sits in the
// unmapped appendix) and only its derivative surfaces in the editor:
// "Parameter '__frame' implicitly has an 'any' type" on the infer function
// header. `nola check` already answers this case with the compiler's ambient
// stub (tshost falls back to RUNTIME_AMBIENT_STUB in bare projects); the
// editor hosts do the same through this decoration. The real package wins
// whenever it resolves.
import { decorateHostWithRuntimeStub } from "@nola-lang/typescript-plugin";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = "/proj";
const LOWERED = [
  'import { __nola } from "@nola-lang/runtime";',
  "export function go(message: string) {",
  "  return __nola.intents.Intent(async (__frame) => {",
  "    const person = await __nola.ask(__nola.intents.ExtractIntent({ instruction: `p`, type: __nola.types.string(), loc: '1:1' }), __frame);",
  "    return person;",
  "  }, __nola.context.file('src/a.tsi').func({ fn: 'go', args: [] }));",
  "}",
  "",
].join("\n");

function makeService(files: Record<string, string>, decorate: boolean): ts.LanguageService {
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => Object.keys(files).filter((f) => f.endsWith(".ts") && !f.includes("/node_modules/")),
    getScriptVersion: () => "1",
    getScriptSnapshot: (f) => {
      if (f in files) return ts.ScriptSnapshot.fromString(files[f] as string);
      const onDisk = ts.sys.readFile(f); // the default lib files
      return onDisk === undefined ? undefined : ts.ScriptSnapshot.fromString(onDisk);
    },
    getCurrentDirectory: () => ROOT,
    getCompilationSettings: () => ({
      strict: true,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2022,
      skipLibCheck: true,
      noEmit: true,
    }),
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => f in files || ts.sys.fileExists(f),
    readFile: (f) => files[f] ?? ts.sys.readFile(f),
    directoryExists: (d) => Object.keys(files).some((f) => f.startsWith(`${d}/`)) || ts.sys.directoryExists(d),
    getDirectories: () => [],
  };
  if (decorate) decorateHostWithRuntimeStub(ts, host);
  return ts.createLanguageService(host);
}

const codes = (service: ts.LanguageService, file: string): number[] =>
  [...service.getSyntacticDiagnostics(file), ...service.getSemanticDiagnostics(file)].map((d) => d.code);

describe("decorateHostWithRuntimeStub", () => {
  it("without the decoration an unresolvable runtime yields TS2307 plus the derivative TS7006", () => {
    const service = makeService({ [`${ROOT}/src/a.ts`]: LOWERED }, false);
    const diags = codes(service, `${ROOT}/src/a.ts`);
    expect(diags).toContain(2307);
    expect(diags).toContain(7006);
  });

  it("serves the ambient stub for `@nola-lang/runtime` when it does not resolve — lowered code is clean", () => {
    const service = makeService({ [`${ROOT}/src/a.ts`]: LOWERED }, true);
    expect(codes(service, `${ROOT}/src/a.ts`)).toEqual([]);
    // the stub is a program file now (resolved, external-library style)
    const program = service.getProgram();
    const stub = program?.getSourceFiles().find((f) => f.fileName.endsWith("/__nola_stubs__/runtime.d.ts"));
    expect(stub).toBeDefined();
    expect(stub && program?.isSourceFileFromExternalLibrary(stub)).toBe(true);
  });

  it("the installed package wins whenever it resolves", () => {
    const pkgDir = `${ROOT}/node_modules/@nola-lang/runtime`;
    const service = makeService(
      {
        [`${ROOT}/package.json`]: JSON.stringify({ type: "module" }),
        [`${ROOT}/src/a.ts`]: `import { marker } from "@nola-lang/runtime";\nexport const m: 1 = marker;\n`,
        [`${pkgDir}/package.json`]: JSON.stringify({
          name: "@nola-lang/runtime",
          type: "module",
          exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
        }),
        [`${pkgDir}/dist/index.d.ts`]: "export declare const marker: 1;\n",
      },
      true,
    );
    // `marker` exists only in the fake installed package, never in the stub
    expect(codes(service, `${ROOT}/src/a.ts`)).toEqual([]);
    const program = service.getProgram();
    expect(program?.getSourceFiles().some((f) => f.fileName.endsWith("/__nola_stubs__/runtime.d.ts"))).toBe(false);
  });

  it("leaves every other unresolvable specifier alone", () => {
    const service = makeService({ [`${ROOT}/src/a.ts`]: 'import { x } from "some-missing-package";\nexport const y = x;\n' }, true);
    expect(codes(service, `${ROOT}/src/a.ts`)).toContain(2307);
  });
});
