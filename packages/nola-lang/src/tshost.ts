import { posix } from "node:path";
import { compileView, loweredVirtualNameFor, RUNTIME_AMBIENT_STUB, viewSourceCandidates } from "@nola-lang/compiler";
import ts from "typescript";

const RUNTIME_STUB = RUNTIME_AMBIENT_STUB;

const STUB_RUNTIME_PATH = "/__nola_stubs__/runtime.d.ts";

export interface LoweredEntry {
  file: string;
  loweredCode: string;
}

export interface LoweredProgram {
  program: ts.Program;
  virtualName(file: string): string;
  options: ts.CompilerOptions;
  /** normalized virtual `…/x.tsi.ts` of every VIEW the resolver derived -> the on-disk `x.ts` / `x.d.ts` it came from */
  views: Map<string, string>;
}

function norm(p: string): string {
  return p.replace(/\\/g, "/");
}

export interface LoweredProgramHooks {
  /**
   * The FINALIZED code of the view of a plain module (emit 15): what the
   * DerivationService's `deriveView` returns. Without it the resolver serves
   * the phase-1 view (inert accessors) — enough for types, but the
   * UnsupportedType elaboration and any emitted `.tsi.js` need the real bodies.
   */
  deriveView?: (source: string) => string | undefined;
}

export function createLoweredProgram(
  entries: LoweredEntry[],
  projectDir: string,
  mode: "check" | "declarations",
  sourceRoot: string,
  hooks: LoweredProgramHooks = {},
): LoweredProgram {
  const virtual = new Map<string, string>();
  const views = new Map<string, string>();
  const virtualName = (file: string) => loweredVirtualNameFor(file);
  for (const e of entries) virtual.set(virtualName(e.file), e.loweredCode);

  let options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
  };
  // The project's plain .ts files join the program roots (the vue-tsc role):
  // their `./x.tsi` imports resolve to the LIVE lowered virtuals — or to the
  // VIEW of a plain module — below, so no declaration files are needed
  // anywhere. Stale .d.tsi.ts artifacts of the old adjacent emit are excluded
  // outright. Both modes: a view reachable only from a user's .ts must be
  // discovered for the declarations pass too.
  let projectTsFiles: string[] = [];
  const configPath = ts.findConfigFile(projectDir, ts.sys.fileExists, "tsconfig.json");
  if (configPath) {
    const parsed = ts.parseJsonConfigFileContent(
      ts.readConfigFile(configPath, ts.sys.readFile).config,
      ts.sys,
      projectDir,
    );
    options = { ...parsed.options, ...options, strict: parsed.options.strict ?? true };
    projectTsFiles = parsed.fileNames.map(norm).filter((f) => !f.endsWith(".d.tsi.ts"));
  }
  options =
    mode === "check"
      ? { ...options, noEmit: true }
      : { ...options, noEmit: false, declaration: true, emitDeclarationOnly: true };

  // Bare projects (tests) can't resolve the runtime the lowering imports
  // (`@nola-lang/runtime`) — fall back to stubs.
  const probe = ts.resolveModuleName("@nola-lang/runtime", `${norm(projectDir)}/probe.ts`, options, ts.sys);
  if (!probe.resolvedModule) {
    virtual.set(STUB_RUNTIME_PATH, RUNTIME_STUB);
    options = {
      ...options,
      baseUrl: "/",
      paths: {
        "@nola-lang/runtime": [STUB_RUNTIME_PATH],
      },
    };
  }

  const host = ts.createCompilerHost(options);
  const defaultReadFile = host.readFile.bind(host);
  const defaultFileExists = host.fileExists.bind(host);
  const defaultGetSourceFile = host.getSourceFile.bind(host);
  host.readFile = (f) => virtual.get(norm(f)) ?? defaultReadFile(f);
  host.fileExists = (f) => virtual.has(norm(f)) || defaultFileExists(f);
  host.getSourceFile = (f, lang, onError, shouldCreate) =>
    virtual.has(norm(f))
      ? ts.createSourceFile(f, virtual.get(norm(f)) as string, lang)
      : defaultGetSourceFile(f, lang, onError, shouldCreate);

  const defaultResolve = (specifier: string, containing: string) =>
    ts.resolveModuleName(specifier, containing, options, {
      fileExists: host.fileExists,
      readFile: (f) => host.readFile(f) ?? undefined,
    }).resolvedModule;
  host.resolveModuleNameLiterals = (literals, containingFile) =>
    literals.map((lit) => {
      const spec = lit.text;
      if (spec.endsWith(".tsi")) {
        const base = norm(containingFile).replace(/\/[^/]*$/, "");
        // path.posix.join keeps a Windows drive prefix intact and, unlike a
        // file: URL, never doubles a leading `/` on POSIX (which would miss the
        // virtual key and let a stale adjacent .d.tsi.ts win).
        const target = posix.join(base, spec);
        const virt = `${target}.ts`;
        if (!virtual.has(virt) && !defaultFileExists(target)) {
          // The *.tsi rule (spec §2): no Nola file here — derive the view of
          // x.ts / x.d.ts once, keyed under the virtual name handed back.
          const src = viewSourceCandidates(target).find((c) => defaultFileExists(c));
          if (src) {
            const code = hooks.deriveView?.(src) ?? compileView(defaultReadFile(src) ?? "", src, { sourceRoot }).code;
            if (code !== "") {
              virtual.set(virt, code);
              views.set(virt, src);
            }
          }
        }
        if (virtual.has(virt)) {
          return {
            resolvedModule: { resolvedFileName: virt, extension: ts.Extension.Ts, isExternalLibraryImport: false },
          };
        }
      }
      return { resolvedModule: defaultResolve(spec, containingFile) ?? undefined };
    });

  const rootNames = [
    ...entries.map((e) => virtualName(e.file)),
    ...projectTsFiles,
    ...(virtual.has(STUB_RUNTIME_PATH) ? [STUB_RUNTIME_PATH] : []),
  ];
  const program = ts.createProgram(rootNames, options, host);
  return { program, virtualName, options, views };
}
