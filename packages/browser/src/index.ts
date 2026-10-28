// @nola-lang/browser: what a browser host needs beyond the compiler (see README.md).
// TypeScript is a parameter of every function that needs it, never an import.
export { blobModuleUrl, type RewrittenImports, rewriteRuntimeImport, withInlineMap } from "./module.js";
export { type StripOptions, type Stripped, stripLowered, type TypeScriptModule } from "./strip.js";
export { type Blanker, createBlanker } from "./vendor/ts-blank-space/index.js";
