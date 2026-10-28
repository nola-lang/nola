// Phase 2 on Node for a one-file program: the checker over a throwaway program — what a host
// without Node (the app's language worker) hands in from its live program. Shared by the
// browser package's tests and test/e2e/browser-bundle.test.ts.
import { type CompileResult, displayPathFor, finalizeDerivations, loweredVirtualNameFor, RUNTIME_AMBIENT_STUB } from "@nola-lang/compiler";
import { answerRequests } from "@nola-lang/derive";
import ts from "typescript";

export function finalizeOnNode(phase1: CompileResult, file: string): CompileResult {
  const virtualName = loweredVirtualNameFor(file);
  const runtimeDir = "/node_modules/@nola-lang/runtime";
  const virtual: Record<string, string> = {
    [virtualName]: phase1.code,
    [`${runtimeDir}/package.json`]: JSON.stringify({ name: "@nola-lang/runtime", types: "./index.d.ts" }),
    [`${runtimeDir}/index.d.ts`]: RUNTIME_AMBIENT_STUB,
  };
  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  };
  const base = ts.createCompilerHost(options);
  const norm = (p: string) => p.replace(/\\/g, "/");
  const host: ts.CompilerHost = {
    ...base,
    fileExists: (f) => norm(f) in virtual || base.fileExists(f),
    readFile: (f) => virtual[norm(f)] ?? base.readFile(f),
    directoryExists: (d) => {
      const n = norm(d).replace(/\/$/, "");
      return Object.keys(virtual).some((p) => p.startsWith(`${n}/`)) || (base.directoryExists?.(d) ?? false);
    },
    getSourceFile: (f, languageVersion) => {
      const text = virtual[norm(f)];
      return text === undefined ? base.getSourceFile(f, languageVersion) : ts.createSourceFile(f, text, languageVersion, true);
    },
    getCurrentDirectory: () => "/",
  };
  const program = ts.createProgram([virtualName], options, host);
  const sf = program.getSourceFile(virtualName);
  if (!sf) throw new Error(`the program has no ${virtualName}`);
  const answers = answerRequests(program, sf, phase1.meta.derivations, {
    importerFile: virtualName,
    importerDisplayFile: displayPathFor(file, "/"),
    sourceRoot: "/",
  });
  return finalizeDerivations(phase1, answers, file);
}
