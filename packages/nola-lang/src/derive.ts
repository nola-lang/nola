import { type CompileResult, compileNola, finalizeDerivations } from "@nola-lang/compiler";
import type { UnderivableContextTypeMode } from "@nola-lang/core";
import { createDerivationService, type DerivationService } from "@nola-lang/derive";

/**
 * The checker-backed derivation seam of `nola build` / `nola check` /
 * `nola declarations` (emit 15): one DerivationService per command, phase 1
 * → answers → finalize for every `.tsi`, and the finalized view of every plain
 * module the lowered program reaches (fed to tshost through its `deriveView`
 * hook, so the program type-checks the REAL bodies — the UnsupportedType
 * elaboration included — and the emitted `.tsi.js` of a view is complete).
 */
export interface ProjectDeriver {
  readonly service: DerivationService;
  /** phase 1 + derive + finalize; `diagnostics` carries NOLA2002 / NOLA2008 next to the parse/lower ones */
  lower(file: string, source: string): CompileResult;
  /** finalized code of the view of `source` (x.ts / x.d.ts), memoized; undefined when the source does not parse */
  viewCode(source: string): string | undefined;
  dispose(): void;
}

export function createProjectDeriver(
  projectDir: string,
  sourceRoot: string,
  underivableContextType: UnderivableContextTypeMode,
): ProjectDeriver {
  const service = createDerivationService({ projectRoot: projectDir, sourceRoot, underivableContextType });
  const views = new Map<string, string | undefined>();
  return {
    service,
    lower(file, source) {
      const phase1 = compileNola(source, file, { sourceRoot, underivableContextType });
      if (phase1.diagnostics.length > 0) return phase1;
      return finalizeDerivations(phase1, service.derive(file, phase1).answers, file);
    },
    viewCode(source) {
      const key = source.replace(/\\/g, "/");
      if (!views.has(key)) {
        const view = service.deriveView(source);
        views.set(key, view.code === "" || view.diagnostics.length > 0 ? undefined : view.code);
      }
      return views.get(key);
    },
    dispose() {
      service.dispose();
    },
  };
}
