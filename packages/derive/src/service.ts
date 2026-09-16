import { existsSync, readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import type { Diagnostic } from "@nola-lang/ast";
import {
  type CompileResult,
  compileNola,
  compileView,
  type DerivationAnswer,
  displayPathFor,
  finalizeDerivations,
  loweredVirtualNameFor,
  posixDirname,
  posixJoin,
  type ViewResult,
  viewSourceCandidates,
} from "@nola-lang/compiler";
import type { UnderivableContextTypeMode } from "@nola-lang/core";
import type ts from "typescript";
import { answerRequests } from "./answer.js";
import { TS } from "./ts.js";
import { readTsconfig } from "./tsconfig.js";

export interface DerivationServiceOptions {
  /** absolute; the tsconfig is searched upward from here */
  projectRoot: string;
  sourceRoot: string;
  underivableContextType: UnderivableContextTypeMode;
  /** phase 1 for a .tsi the checker needs but the caller did not hand over (default: compileNola strict) */
  lowerFile?: (file: string, source: string) => { code: string };
}

export interface DerivationService {
  /** answer every request of a phase-1 result; the lowered text is registered under the file's virtual name first */
  derive(file: string, phase1: CompileResult): { answers: DerivationAnswer[]; diagnostics: Diagnostic[] };
  /** compileView + derive + finalize for the plain module `./x.tsi` is a view of */
  deriveView(file: string, options?: { sourceSpecifier?: string }): ViewResult & { answers: DerivationAnswer[] };
  /** a file changed (watch mode): forget its virtual and bump its version; dependents re-derive on their next call */
  invalidate(file: string): void;
  dispose(): void;
}

const norm = (p: string): string => p.replace(/\\/g, "/");
const viewVirtualName = (file: string): string => `${norm(file).replace(/\.d\.ts$|\.ts$/, "")}.tsi.ts`;

/**
 * One TypeScript language service per process (spec §4.2). The host follows
 * tshost: root files are the nearest tsconfig's, `.tsi` files (and the views
 * of plain modules) are served as lowered virtuals `x.tsi.ts` produced by
 * phase 1 only — types are verbatim there, bodies are irrelevant to the
 * checker — and the `.tsi` specifier rule of emit 14 applies to imports.
 */
export function createDerivationService(o: DerivationServiceOptions): DerivationService {
  const t0 = performance.now();
  const cfg = readTsconfig(o.projectRoot);
  if (cfg.warning) console.warn(`nola: ${cfg.warning}`);
  const lower =
    o.lowerFile ??
    ((file, source) =>
      compileNola(source, file, { sourceRoot: o.sourceRoot, underivableContextType: o.underivableContextType }));

  const virtual = new Map<string, { text: string; version: number }>();
  const versions = new Map<string, number>();
  const roots = new Set<string>(cfg.fileNames);

  const register = (name: string, text: string): void => {
    const prev = virtual.get(name);
    virtual.set(name, { text, version: (prev?.version ?? 0) + 1 });
    roots.add(name);
  };
  const ensureTsi = (file: string): void => {
    const name = loweredVirtualNameFor(file);
    if (!virtual.has(name) && existsSync(file)) register(name, lower(file, readFileSync(file, "utf8")).code);
  };
  const ensureView = (tsiTarget: string): string | undefined => {
    const name = `${norm(tsiTarget)}.ts`;
    if (virtual.has(name)) return name;
    const src = viewSourceCandidates(tsiTarget).find((c) => existsSync(c));
    if (!src) return undefined;
    const view = compileView(readFileSync(src, "utf8"), src, { sourceRoot: o.sourceRoot });
    if (view.code === "") return undefined;
    register(name, view.code);
    return name;
  };

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => cfg.options,
    getScriptFileNames: () => [...roots],
    getScriptVersion: (f) => String(virtual.get(norm(f))?.version ?? versions.get(norm(f)) ?? 0),
    getScriptSnapshot: (f) => {
      const v = virtual.get(norm(f));
      if (v) return TS.ScriptSnapshot.fromString(v.text);
      const text = TS.sys.readFile(f);
      return text === undefined ? undefined : TS.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => o.projectRoot,
    getDefaultLibFileName: (opts) => TS.getDefaultLibFilePath(opts),
    fileExists: (f) => virtual.has(norm(f)) || TS.sys.fileExists(f),
    readFile: (f) => virtual.get(norm(f))?.text ?? TS.sys.readFile(f),
    readDirectory: TS.sys.readDirectory,
    directoryExists: TS.sys.directoryExists,
    getDirectories: TS.sys.getDirectories,
    resolveModuleNameLiterals: (literals, containingFile, _redirected, options) =>
      literals.map((lit) => {
        const spec = lit.text;
        if (spec.endsWith(".tsi") && (spec.startsWith("./") || spec.startsWith("../"))) {
          const target = posixJoin(posixDirname(norm(containingFile)), spec);
          if (existsSync(target)) {
            ensureTsi(target);
            return {
              resolvedModule: {
                resolvedFileName: loweredVirtualNameFor(target),
                extension: TS.Extension.Ts,
                isExternalLibraryImport: false,
              },
            };
          }
          const view = ensureView(target);
          if (view) {
            return { resolvedModule: { resolvedFileName: view, extension: TS.Extension.Ts, isExternalLibraryImport: false } };
          }
        }
        return { resolvedModule: TS.resolveModuleName(spec, containingFile, options, host).resolvedModule };
      }),
  };
  const ls = TS.createLanguageService(host, TS.createDocumentRegistry());
  if (process.env.NOLA_DERIVE_TIMING) {
    console.error(`derive: service cold ${(performance.now() - t0).toFixed(0)} ms, roots ${roots.size}`);
  }

  const answer = (
    virtualName: string,
    requests: CompileResult["meta"]["derivations"],
    importerFile: string,
  ): DerivationAnswer[] => {
    const t1 = performance.now();
    const program = ls.getProgram();
    if (!program) throw new Error("derive: the language service has no program");
    const sf = program.getSourceFile(virtualName);
    if (!sf) throw new Error(`derive: ${virtualName} is not in the program`);
    const answers = answerRequests(program, sf, requests, {
      importerFile,
      importerDisplayFile: displayPathFor(importerFile, o.sourceRoot),
      sourceRoot: o.sourceRoot,
    });
    if (process.env.NOLA_DERIVE_TIMING) {
      console.error(`derive: ${displayPathFor(importerFile, o.sourceRoot)} ${(performance.now() - t1).toFixed(1)} ms`);
    }
    return answers;
  };

  return {
    derive(file, phase1) {
      const name = loweredVirtualNameFor(file);
      register(name, phase1.code);
      return { answers: answer(name, phase1.meta.derivations, file), diagnostics: [] };
    },
    deriveView(file, options) {
      const view = compileView(readFileSync(file, "utf8"), file, {
        sourceRoot: o.sourceRoot,
        ...(options?.sourceSpecifier ? { sourceSpecifier: options.sourceSpecifier } : {}),
      });
      if (view.code === "") return { ...view, answers: [] };
      const name = viewVirtualName(file);
      register(name, view.code);
      const answers = answer(name, view.derivations, file);
      return { ...finalizeDerivations(view, answers, file), answers };
    },
    invalidate(file) {
      const f = norm(file);
      versions.set(f, (versions.get(f) ?? 0) + 1);
      virtual.delete(viewVirtualName(f));
      virtual.delete(loweredVirtualNameFor(f));
    },
    dispose() {
      ls.dispose();
    },
  };
}
