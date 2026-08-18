import { transformNola } from "@nola-lang/node-loader";
import type { ProjectContext } from "./project.js";

/**
 * The wiring virtual id carries the config path as a query param, so `load`
 * needs no shared plugin state to find the config the importing module was
 * compiled against. Deliberately SCHEME-LESS (no colon): webpack routes
 * URI-scheme requests past enhanced-resolve, so a "virtual:" prefix would
 * bypass unplugin's resolver hook there.
 */
export const WIRING_ID = "virtual-nola-config";
export const RESOLVED_WIRING_ID = "\0virtual-nola-config";

export function wiringIdFor(configPath: string): string {
  return `${WIRING_ID}?path=${encodeURIComponent(configPath)}`;
}

/** The config path out of a (resolved or unresolved) wiring id. */
export function configPathFromWiringId(id: string): string {
  const query = id.slice(id.indexOf("?path=") + "?path=".length);
  return decodeURIComponent(query);
}

export function isWiringId(id: string): boolean {
  return id.startsWith(WIRING_ID) || id.startsWith(RESOLVED_WIRING_ID);
}

/**
 * The self-configuring wrapper as a virtual module. Mirrors
 * bundleSelfConfiguringConfig (node-loader/bundle-config.ts) except the config
 * is imported as a normal specifier so the BUNDLER bundles the config graph —
 * watch/HMR for free, no nested esbuild pass. Importing is idempotent (ESM
 * module cache); configure() before the first ask is legal from every module.
 */
export function wiringSource(configPath: string): string {
  return [
    `import config from ${JSON.stringify(configPath.replace(/\\/g, "/"))};`,
    `import { nolaRuntime } from "@nola-lang/runtime";`,
    `nolaRuntime.configure(config, { source: "nola.config.ts" });`,
    "",
  ].join("\n");
}

/**
 * Lower one .tsi to final JS + merged map. The wiring import is appended AFTER
 * transformNola, at EOF — exactly like nola build appends its dist import:
 * unmapped, original positions intact.
 */
export async function transformTsi(
  source: string,
  file: string,
  ctx: ProjectContext,
): Promise<{ code: string; map: string }> {
  const { code, map } = await transformNola(source, file, {
    sourceRoot: ctx.sourceRoot,
    underivableContextType: ctx.underivableContextType,
  });
  if (ctx.target === "app" && ctx.configPath !== null) {
    return { code: `${code}\nimport ${JSON.stringify(wiringIdFor(ctx.configPath))};\n`, map };
  }
  return { code, map };
}
