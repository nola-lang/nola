/**
 * `Bun.resolveSync` behind a seam: the unit tests run under vitest on Node and inject a
 * resolver; under Bun the global is used. Nothing in this package imports the `bun`
 * module at load time, so the modules load under Node too.
 */
export type Resolver = (specifier: string, parentDir: string) => string;

let injected: Resolver | undefined;

export function setResolver(fn: Resolver | undefined): void {
  injected = fn;
}

export function resolveFrom(specifier: string, parentDir: string): string {
  if (injected) return injected(specifier, parentDir);
  const bun = (globalThis as { Bun?: { resolveSync?: Resolver } }).Bun;
  if (typeof bun?.resolveSync !== "function") {
    throw new Error("@nola-lang/bun: Bun.resolveSync is unavailable — this plugin runs under Bun");
  }
  return bun.resolveSync(specifier, parentDir);
}
