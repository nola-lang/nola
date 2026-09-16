// Turbopack runs webpack-compatible loaders but has no virtual-module layer,
// so this loader inlines what the unplugin path serves virtually: the lowering
// (transformNola), the views the checker pass imports (inlineViews), and the
// self-configuring wrapper (config imported by real path; configure() before
// the first ask is idempotent-safe per module). User config is NEVER
// evaluated here — the wiring only checks the file exists;
// `underivableContextType` comes from the compiler's STATIC extraction (same
// stance as the editor layer). `@nola-lang/derive` (and its TypeScript) is
// resolved at run time from the project's dependencies, not bundled.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { staticUnderivableContextType } from "@nola-lang/compiler";
import { createDerivationService, type DerivationService } from "@nola-lang/derive";
import { findProjectRoot, transformNola } from "@nola-lang/node-loader";
import { inlineViews } from "./inline-views.js";

interface LoaderCtx {
  async(): (err: Error | null, code?: string, map?: object) => void;
  resourcePath: string;
  /** webpack-compatible: a file this module's output depends on (type-only edges) */
  addDependency?(file: string): void;
}

/** One checker per project root for the life of the loader process (dev server, build). */
const services = new Map<string, DerivationService>();
function serviceFor(root: string, underivableContextType: "error" | "prune" | "omit"): DerivationService {
  let service = services.get(root);
  if (!service) {
    service = createDerivationService({ projectRoot: root, sourceRoot: root, underivableContextType });
    services.set(root, service);
  }
  return service;
}

export default function nolaTurbopackLoader(this: LoaderCtx, source: string): void {
  const callback = this.async();
  const file = this.resourcePath;
  const root = findProjectRoot(dirname(file));
  const configPath = join(root, "nola.config.ts");
  const underivableContextType = existsSync(configPath)
    ? (staticUnderivableContextType(readFileSync(configPath, "utf8")) ?? undefined)
    : undefined;
  const service = serviceFor(root, underivableContextType ?? "error");
  // a changed file re-enters through the loader: forget what the checker knew about it
  service.invalidate(file);
  transformNola(source, file, {
    sourceRoot: root,
    underivableContextType,
    derive: (f, phase1) => service.derive(f, phase1).answers,
    inlineViews: (lowered) => inlineViews(lowered, file, root, service),
  })
    .then(({ code, map, deps }) => {
      for (const dep of deps) this.addDependency?.(dep);
      let wired = code;
      if (existsSync(configPath)) {
        // RELATIVE to the importing file, never absolute: Turbopack reads a
        // leading `/` as a server-relative (URL-root) import — "server relative
        // imports are not implemented yet" — so an absolute POSIX path fails
        // every Linux build (a `D:/…` path happens to resolve on Windows).
        let spec = relative(dirname(file), configPath).replace(/\\/g, "/");
        if (!spec.startsWith(".")) spec = `./${spec}`;
        wired = [
          code,
          `import __nola_user_config from ${JSON.stringify(spec)};`,
          `import { nolaRuntime as __nola_rt } from "@nola-lang/runtime";`,
          `__nola_rt.configure(__nola_user_config, { source: "nola.config.ts" });`,
          "",
        ].join("\n");
      }
      callback(null, wired, JSON.parse(map) as object);
    })
    .catch((err) => callback(err as Error));
}
