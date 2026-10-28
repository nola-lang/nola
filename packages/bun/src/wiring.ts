import { resolveFrom } from "./resolve.js";

/** The same id the bundler plugins use (unplugin core.ts): scheme-less, the config path as a query param. */
export const WIRING_ID = "virtual-nola-config";
/** The namespace the wiring module is served in (bundle mode only). */
export const WIRING_NAMESPACE = "nola-wiring";

export function wiringIdFor(configPath: string): string {
  return `${WIRING_ID}?path=${encodeURIComponent(configPath)}`;
}

export function configPathFromWiringId(id: string): string {
  return decodeURIComponent(id.slice(id.indexOf("?path=") + "?path=".length));
}

export function isWiringId(id: string): boolean {
  return id.startsWith(WIRING_ID);
}

const posix = (p: string): string => p.replaceAll("\\", "/");

/**
 * The self-configuring module (node-loader's bundleSelfConfiguringConfig, unplugin's
 * wiringSource) with BOTH imports absolute: a namespaced Bun module has no resolve
 * directory, so the config goes in by its path and the runtime by `Bun.resolveSync`
 * against the project root — the very file the lowered modules import, so the bundle
 * holds one runtime instance. Imports hoist: configure() runs before any module body.
 */
export function wiringSource(configPath: string, projectRoot: string): string {
  const runtime = resolveFrom("@nola-lang/runtime", projectRoot);
  return [
    `import config from ${JSON.stringify(posix(configPath))};`,
    `import { nolaRuntime } from ${JSON.stringify(posix(runtime))};`,
    'nolaRuntime.configure(config, { source: "nola.config.ts" });',
    "",
  ].join("\n");
}
