import { nodeAbsenceReason, nodeBuiltin } from "@nola-lang/core";
import type TypeScript from "typescript";

type TypeScriptModule = typeof TypeScript;

let injected: TypeScriptModule | undefined;
let own: TypeScriptModule | undefined;

/**
 * Hand derive the TypeScript module the host program was built with. The
 * editors MUST call this: the language server passes the tsdk the client
 * named, the tsserver plugin the module tsserver hands its factory. Their
 * bundles keep `typescript` external and ship with no copy beside them (the
 * VSIX stages only the bundles), so a static `require("typescript")` would
 * crash the server at load — and walking a program with a different
 * TypeScript instance than the one that built it is wrong anyway.
 */
export function useTypeScript(module: TypeScriptModule): void {
  injected = module;
}

/**
 * The loader, the CLI and the bundler plugins never inject: derive's own
 * dependency serves them, resolved on first use through `node:module`
 * reached at call time (`process.getBuiltinModule`, on every Node the
 * floor admits; `import.meta.url` is this file's — or, in a CJS bundle, the
 * URL its build injects). No static `node:` import, so a browser bundle of
 * derive carries no Node specifier and reaches the throw below only when
 * the host forgot to inject.
 */
function load(): TypeScriptModule {
  if (injected) return injected;
  if (!own) {
    const mod = nodeBuiltin<{ createRequire: (from: string) => (id: string) => unknown }>("node:module");
    // A bundle built without the import.meta.url inject has no usable URL for createRequire either.
    const from = import.meta.url;
    if (!mod || typeof from !== "string") {
      throw new Error(
        `derive: no TypeScript module — inject the host's with useTypeScript() (${mod ? "this bundle carries no import.meta.url to resolve one from" : nodeAbsenceReason()})`,
      );
    }
    own = mod.createRequire(from)("typescript") as TypeScriptModule;
  }
  return own;
}

/**
 * The `typescript` module, resolved lazily on first property access: enums
 * (`TS.TypeFlags.String`), predicates (`TS.isIdentifier(node)`), `TS.sys`,
 * factories. Types keep coming from `import type ts from "typescript"`.
 */
export const TS: TypeScriptModule = new Proxy({} as TypeScriptModule, {
  get: (_target, key) => Reflect.get(load(), key),
  has: (_target, key) => Reflect.has(load(), key),
});
