import { Codes } from "@nola-lang/ast";
import { createUnplugin, type SourceMapCompact, type UnpluginFactory, type UnpluginInstance } from "unplugin";
import { configPathFromWiringId, RESOLVED_WIRING_ID, transformTsi, WIRING_ID, wiringSource } from "./core.js";
import { invalidateProjects, type NolaPluginOptions, projectFor, projectForDir } from "./project.js";
import { guardConfigGraphTsi, loadViewCode, resolveViewId, VIEW_PREFIX } from "./views.js";

export type { NolaPluginOptions } from "./project.js";

const CLIENT_ERROR =
  `${Codes.TsiInClientBundle}: .tsi modules are server-only in Nola v0 — this file is being bundled ` +
  `for a browser target. Move the import behind a server boundary (SSR entry, route handler, server action).`;

export const unpluginFactory: UnpluginFactory<NolaPluginOptions | undefined> = (rawOptions) => {
  const options = rawOptions ?? {};
  // webpack/rspack: the compiler target is known at apply time; transform reads it.
  let clientBuild = false;
  let declTimer: NodeJS.Timeout | undefined;
  const declRoots = new Set<string>();

  // Adjacent d.tsi.ts so plain tsc / framework type checks resolve .tsi
  // imports (allowArbitraryExtensions). nola-lang is imported lazily — it
  // drags the TypeScript compiler API, which plugin import must not.
  const emitDeclarationsFor = async (root: string) => {
    const ctx = await projectForDir(root, options);
    if (!ctx.declarations) return;
    const { emitAdjacentDeclarations } = await import("nola-lang");
    const { errors } = await emitAdjacentDeclarations(ctx.sourceRoot);
    for (const e of errors) console.error(e);
  };

  const doTransform = async (source: string, id: string) => {
    const ctx = await projectFor(id, options);
    // Declarations are scoped to the project root of a .tsi ACTUALLY being
    // bundled — never process.cwd(): a bundler API call can run from any
    // directory (a monorepo root), and walking it would spray d.tsi.ts far
    // outside the app. Once per root per build.
    if (ctx.declarations && !declRoots.has(ctx.sourceRoot)) {
      declRoots.add(ctx.sourceRoot);
      await emitDeclarationsFor(ctx.sourceRoot);
    }
    return transformTsi(source, id, ctx);
  };

  return {
    name: "nola",
    enforce: "pre",

    transformInclude: (id) => id.endsWith(".tsi"),

    async buildStart() {
      // Only an EXPLICIT root emits ahead of any transform — the safe default
      // waits for the first .tsi to reveal the real project root.
      if (options.root !== undefined) await emitDeclarationsFor(options.root);
    },

    watchChange(id) {
      // any file may hold a type a .tsi derives from (emit 15): forget it in every service
      void invalidateProjects(id);
      if (!id.endsWith(".tsi")) return;
      clearTimeout(declTimer);
      declTimer = setTimeout(() => {
        for (const root of declRoots) void emitDeclarationsFor(root);
        if (options.root !== undefined) void emitDeclarationsFor(options.root);
      }, 150);
    },

    async transform(source, id) {
      if (clientBuild) this.error(CLIENT_ERROR);
      const { code, map, deps } = await doTransform(source, id);
      // type-only dependencies: the declaration files the checker read
      for (const dep of deps) this.addWatchFile(dep);
      return { code, map: JSON.parse(map) as SourceMapCompact };
    },

    resolveId(id, importer) {
      guardConfigGraphTsi(id, importer);
      if (id.startsWith(WIRING_ID)) return `\0${id}`;
      if (importer === undefined) return null;
      // A view importing a view arrives with the prefixed id as importer.
      const importerFile = importer.startsWith(VIEW_PREFIX) ? importer.slice(VIEW_PREFIX.length) : importer;
      return resolveViewId(id, importerFile);
    },

    async load(id) {
      if (id.startsWith(RESOLVED_WIRING_ID)) {
        const configPath = configPathFromWiringId(id);
        this.addWatchFile(configPath);
        return wiringSource(configPath);
      }
      if (id.startsWith(VIEW_PREFIX)) {
        const file = id.slice(VIEW_PREFIX.length);
        const ctx = await projectFor(file, options);
        const { code, watchFiles } = await loadViewCode(id, ctx.service);
        for (const w of watchFiles) this.addWatchFile(w);
        return code;
      }
      return null;
    },

    vite: {
      transform: {
        // Vite hands the ssr flag per transform — the one reliable client/server signal.
        async handler(source, id, viteOpts) {
          if (!id.endsWith(".tsi")) return null;
          if (viteOpts?.ssr !== true) this.error(CLIENT_ERROR);
          const { code, map, deps } = await doTransform(source, id);
          for (const dep of deps) this.addWatchFile(dep);
          // Rollup's SourceMapInput accepts the raw JSON string.
          return { code, map };
        },
      },
    },

    webpack(compiler) {
      clientBuild = isBrowserTarget(compiler.options.target);
    },
    rspack(compiler) {
      clientBuild = isBrowserTarget(compiler.options.target);
    },
  };
};

function isBrowserTarget(target: unknown): boolean {
  const list = Array.isArray(target) ? target : typeof target === "string" ? [target] : [];
  return list.some((t) => typeof t === "string" && (t === "web" || t === "webworker" || t.startsWith("browserslist")));
}

export const NolaPlugin: UnpluginInstance<NolaPluginOptions | undefined> = /* @__PURE__ */ createUnplugin(unpluginFactory);
export default NolaPlugin;
