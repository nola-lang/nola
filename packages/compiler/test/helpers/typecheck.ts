import { RUNTIME_AMBIENT_STUB } from "@nola-lang/compiler";
import ts from "typescript";

const RUNTIME_STUB = RUNTIME_AMBIENT_STUB;

/** Type-check lowered TS in memory. Returns formatted errors ([] = clean). */
export function typecheckLowered(files: Record<string, string>): string[] {
  const virtual = new Map<string, string>();
  for (const [name, content] of Object.entries(files)) virtual.set(`/proj/${name}`, content);
  virtual.set("/stubs/runtime.d.ts", RUNTIME_STUB);

  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    noEmit: true,
    baseUrl: "/",
    paths: {
      "@nola-lang/runtime": ["/stubs/runtime.d.ts"],
    },
  };

  const host = ts.createCompilerHost(options);
  const defaultReadFile = host.readFile.bind(host);
  const defaultFileExists = host.fileExists.bind(host);
  const defaultGetSourceFile = host.getSourceFile.bind(host);
  // Virtual dirs like /proj don't exist on disk; without this, resolution
  // short-circuits (directoryProbablyExists) before probing virtual files.
  const defaultDirectoryExists = host.directoryExists?.bind(host);
  host.directoryExists = (d) => {
    const key = `${d.replace(/\\/g, "/").replace(/\/+$/, "")}/`;
    for (const f of virtual.keys()) if (f.startsWith(key)) return true;
    return defaultDirectoryExists ? defaultDirectoryExists(d) : false;
  };
  host.readFile = (f) => virtual.get(f.replace(/\\/g, "/")) ?? defaultReadFile(f);
  host.fileExists = (f) => virtual.has(f.replace(/\\/g, "/")) || defaultFileExists(f);
  host.getSourceFile = (f, lang, onError, shouldCreate) => {
    const key = f.replace(/\\/g, "/");
    if (virtual.has(key)) return ts.createSourceFile(f, virtual.get(key) as string, lang);
    return defaultGetSourceFile(f, lang, onError, shouldCreate);
  };
  host.writeFile = () => {};

  const rootNames = Object.keys(files).map((n) => `/proj/${n}`);
  const program = ts.createProgram(rootNames, options, host);
  return ts.getPreEmitDiagnostics(program).map((d) => {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, " ");
    const where =
      d.file && d.start !== undefined
        ? `${d.file.fileName}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}`
        : "";
    return `${where} TS${d.code}: ${msg}`;
  });
}
