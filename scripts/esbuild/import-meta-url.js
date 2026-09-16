// esbuild's documented recipe for `import.meta.url` in a CJS bundle: inject
// this file and define `import.meta.url` as `import_meta_url`, so the ESM
// branches a bundle inlines (derive's createRequire(import.meta.url) fallback,
// the loader's module.register parentURL, the runtime slot's URL) see the
// bundle's own file URL instead of esbuild's empty `{}` — and the
// empty-import-meta warning never fires.
export let import_meta_url = require("node:url").pathToFileURL(__filename).href;
