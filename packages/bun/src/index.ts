import { dirname } from "node:path";
import type { BunPlugin, PluginBuilder } from "bun";
import { assertBunVersion, guardBrowserTarget, guardConfigGraphTsi } from "./guards.js";
import { lowerTsi } from "./lower.js";
import { type NolaBunOptions, projectFor, projectForDir } from "./project.js";
import { importerFile, loadView, resolveView, VIEW_NAMESPACE } from "./views.js";
import { configPathFromWiringId, WIRING_ID, WIRING_NAMESPACE, wiringSource } from "./wiring.js";

export type { NolaBunOptions } from "./project.js";

/** Bundle mode is `Bun.build`: its config sits on the builder. Runtime mode (`Bun.plugin`) has none. */
function buildConfig(build: PluginBuilder): { target?: string } | undefined {
  return (build as { config?: { target?: string } }).config;
}

/**
 * The one plugin object for `Bun.build({ plugins: [nola()] })` and `Bun.plugin(nola())`
 * (the preload). `.tsi` lowers through the two-phase compile and reaches Bun as
 * TypeScript; views of plain modules, the NOLA3012/NOLA4001 guards and the bundle-mode
 * wiring module mirror @nola-lang/unplugin.
 */
export function nola(options: NolaBunOptions = {}): BunPlugin {
  return {
    name: "nola",
    setup(build) {
      assertBunVersion();
      const config = buildConfig(build);
      const bundle = config !== undefined;

      build.onResolve({ filter: /\.tsi$/ }, (args) => {
        // the runtime prefixes a namespaced importer (a view importing a view): resolve from the file
        const importer = importerFile(args.importer);
        guardConfigGraphTsi(args.path, importer);
        return resolveView(args.path, importer);
      });

      build.onLoad({ filter: /\.tsi$/ }, async (args) => {
        if (bundle) guardBrowserTarget(config);
        const ctx = await projectFor(args.path, options);
        return { contents: lowerTsi(args.path, ctx, bundle && ctx.wire && ctx.target === "app"), loader: "ts" };
      });

      // the view of a plain module, keyed by that module's own path (resolveView admitted it)
      build.onLoad({ filter: /.*/, namespace: VIEW_NAMESPACE }, async (args) => {
        if (bundle) guardBrowserTarget(config);
        const ctx = await projectFor(args.path, options);
        return { contents: loadView(args.path, ctx), loader: "ts" };
      });

      if (bundle) {
        build.onResolve({ filter: new RegExp(`^${WIRING_ID}`) }, (args) => ({ path: args.path, namespace: WIRING_NAMESPACE }));
        build.onLoad({ filter: /.*/, namespace: WIRING_NAMESPACE }, async (args) => {
          const configPath = configPathFromWiringId(args.path);
          const ctx = await projectForDir(dirname(configPath), options);
          return { contents: wiringSource(configPath, ctx.root), loader: "ts" };
        });
      }
    },
  };
}

export default nola;
