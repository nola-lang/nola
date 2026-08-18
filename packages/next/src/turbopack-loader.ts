// Turbopack runs webpack-compatible loaders but has no virtual-module layer,
// so this loader inlines what the unplugin path serves virtually: the lowering
// (transformNola) and the self-configuring wrapper (config imported by real
// path; configure() before the first ask is idempotent-safe per module).
// User config is NEVER evaluated here — the wiring only checks the file
// exists; `underivableContextType` comes from the compiler's STATIC extraction
// (same stance as the editor layer).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { staticUnderivableContextType } from "@nola-lang/compiler";
import { findProjectRoot, transformNola } from "@nola-lang/node-loader";

interface LoaderCtx {
  async(): (err: Error | null, code?: string, map?: object) => void;
  resourcePath: string;
}

export default function nolaTurbopackLoader(this: LoaderCtx, source: string): void {
  const callback = this.async();
  const file = this.resourcePath;
  const root = findProjectRoot(dirname(file));
  const configPath = join(root, "nola.config.ts");
  const underivableContextType = existsSync(configPath)
    ? (staticUnderivableContextType(readFileSync(configPath, "utf8")) ?? undefined)
    : undefined;
  transformNola(source, file, { sourceRoot: root, underivableContextType })
    .then(({ code, map }) => {
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
