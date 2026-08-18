import { fileURLToPath } from "node:url";
import { NolaPlugin, type NolaPluginOptions } from "@nola-lang/unplugin";

export type { NolaPluginOptions } from "@nola-lang/unplugin";

// Loader files ship as CJS bundles next to this module (Turbopack and webpack
// require() loaders). Resolved relative to the built index so no package
// self-reference (and no dist existence check) is needed at config-load time.
const TURBOPACK_LOADER = fileURLToPath(new URL("./turbopack-loader.cjs", import.meta.url));
const CLIENT_ERROR_LOADER = fileURLToPath(new URL("./client-error-loader.cjs", import.meta.url));

/** Structural types — next stays the USER's dependency, not ours. */
export interface NextConfigLike {
  [key: string]: unknown;
  serverExternalPackages?: string[];
  turbopack?: { rules?: Record<string, unknown>; [k: string]: unknown };
  webpack?: (config: WebpackConfigLike, ctx: NextWebpackCtx) => WebpackConfigLike;
}
export interface WebpackConfigLike {
  module: { rules: unknown[] };
  resolve: { extensionAlias?: Record<string, string[]>; [k: string]: unknown };
  plugins: unknown[];
  [k: string]: unknown;
}
export interface NextWebpackCtx {
  isServer: boolean;
  [k: string]: unknown;
}

/**
 * Wrap a Next.js config with Nola support: .tsi lowering in server
 * compilations (webpack mode via @nola-lang/unplugin — its transform also
 * emits the adjacent d.tsi.ts declarations `next build`'s type check needs),
 * a Turbopack rule for dev, a clear NOLA4001 error for client-side imports,
 * and the NodeNext resolve convention.
 */
export function withNola(nextConfig: NextConfigLike = {}, nolaOptions: NolaPluginOptions = {}): NextConfigLike {
  return {
    ...nextConfig,
    // One @nola-lang/runtime copy, resolved from node_modules — never bundled
    // per-chunk (the process-wide runtime slot is NOLA3002 territory).
    serverExternalPackages: [...(nextConfig.serverExternalPackages ?? []), "@nola-lang/runtime"],
    turbopack: {
      ...nextConfig.turbopack,
      rules: {
        ...nextConfig.turbopack?.rules,
        "*.tsi": { loaders: [TURBOPACK_LOADER], as: "*.js" },
      },
    },
    webpack(config, ctx) {
      config.resolve.extensionAlias = { ...config.resolve.extensionAlias, ".js": [".js", ".ts"] };
      if (ctx.isServer) {
        config.plugins.push(NolaPlugin.webpack(nolaOptions));
      } else {
        config.module.rules.push({
          test: /\.tsi$/,
          use: [{ loader: CLIENT_ERROR_LOADER }],
        });
      }
      return nextConfig.webpack ? nextConfig.webpack(config, ctx) : config;
    },
  };
}
