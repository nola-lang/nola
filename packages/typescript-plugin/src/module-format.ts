import type ts from "typescript";

/**
 * What TypeScript's program-side lookup answers: the format alone, or (under
 * Node16/NodeNext) the format plus the package.json it was read from.
 */
type ImpliedFormat =
  | ts.ResolutionMode
  | { impliedNodeFormat: ts.ResolutionMode; packageJsonLocations: readonly string[]; packageJsonScope: unknown };

/** The two INTERNAL TypeScript surfaces this decoration reaches. */
interface FormatInternals {
  getImpliedNodeFormatForFileWorker?(
    fileName: string,
    packageJsonInfoCache: ts.PackageJsonInfoCache | undefined,
    host: ts.ModuleResolutionHost,
    options: ts.CompilerOptions,
  ): ImpliedFormat;
}
interface CompilerHostSink {
  setCompilerHost?(host: ts.CompilerHost): void;
}

/**
 * Gives every `.tsi` source file the module format TypeScript would give the
 * same file named `.ts` — ESM under a `"type": "module"` package.json with
 * Node16/NodeNext, as for every plain module beside it.
 *
 * Why: TypeScript decides a file's format by its EXTENSION (`.mts` ESM, `.cts`
 * CommonJS, `.ts`/`.tsx`/`.js`/`.jsx`/`.d.ts` from package.json `type`) and
 * answers nothing for any other name, so a `.tsi` was created with no format
 * at all. Most checks only refuse a file that IS CommonJS, but `import.meta`
 * is refused in every file that is not positively ESM: TS1470 "The
 * 'import.meta' meta-property is not allowed in files which will build into
 * CommonJS output" on a `.tsi`, while the identical `.ts` was clean. Volar
 * patches the format only for the duration of a module resolution and puts
 * `undefined` back, so the checker never sees it. (`nola check` and derive
 * name the lowered file `x.tsi.ts` and get the right answer without this.)
 *
 * The seam: the language service hands each program's compiler host to the
 * LS host through `setCompilerHost` (internal, called before the program is
 * created) — the hook wraps that host's `getSourceFile` / `getSourceFileByPath`
 * and fills in the format of a `.tsi` the program left undecided, ON the
 * options object the program passes, before the source file is created. The
 * format is therefore decided at creation like any `.ts` file's: the document
 * registry files it under the bucket of that format and releases it from the
 * same one (mutating a created file's format instead desynchronizes them — the
 * reason Volar restores it), and the program copies the package.json scope
 * and locations off the same options object onto the file, as for a `.ts`.
 */
export function decorateHostWithTsiModuleFormat(typescript: typeof ts, host: ts.LanguageServiceHost): void {
  const sink = host as ts.LanguageServiceHost & CompilerHostSink;
  const priorSet = sink.setCompilerHost?.bind(host);
  const worker = (typescript as typeof ts & FormatInternals).getImpliedNodeFormatForFileWorker;

  sink.setCompilerHost = (compilerHost) => {
    const decide = (fileName: string, options: ts.ScriptTarget | ts.CreateSourceFileOptions): void => {
      if (typeof options !== "object" || options.impliedNodeFormat !== undefined || !fileName.endsWith(".tsi")) return;
      const twin = `${fileName}.ts`;
      const cache = compilerHost.getModuleResolutionCache?.()?.getPackageJsonInfoCache();
      const settings = host.getCompilationSettings();
      const implied: ImpliedFormat = worker
        ? worker(twin, cache, compilerHost, settings)
        : typescript.getImpliedNodeFormatForFile(twin, cache, compilerHost, settings);
      Object.assign(options, typeof implied === "object" ? implied : { impliedNodeFormat: implied });
    };

    const getSourceFile = compilerHost.getSourceFile;
    compilerHost.getSourceFile = (fileName, options, ...rest) => {
      decide(fileName, options);
      return getSourceFile.call(compilerHost, fileName, options, ...rest);
    };
    const getSourceFileByPath = compilerHost.getSourceFileByPath;
    if (getSourceFileByPath) {
      compilerHost.getSourceFileByPath = (fileName, path, options, ...rest) => {
        decide(fileName, options);
        return getSourceFileByPath.call(compilerHost, fileName, path, options, ...rest);
      };
    }
    priorSet?.(compilerHost);
  };
}
