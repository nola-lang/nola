# @nola-lang/browser

What a browser host of Nola needs beyond the compiler: the pieces a webview (a Tauri app, a
website playground) otherwise hand-rolls.

- `stripLowered(ts, lowered, { sourceUrl })` — the loader's type strip and debug map for a
  browser: erasable syntax is blanked to whitespace (ts-blank-space, vendored, over the host's
  TypeScript), so the JavaScript keeps the lowered text's line layout and a breakpoint on a `.tsi`
  line binds; non-erasable syntax (an enum, a namespace, parameter properties) is transpiled by
  the same TypeScript with a map merged onto the compiler's. The map names its one source
  `sourceUrl` and embeds the source text.
- `withInlineMap(code, map, sourceUrl)` — the program as one module text with an inline map and a
  stable `//# sourceURL`, so DevTools shows the `.tsi` at a pause and breakpoints survive a re-run.
- `rewriteRuntimeImport(js, runtimeUrl)` — points the program's `@nola-lang/runtime` import at the
  module URL the host provides, and reports every other specifier for the host to decide on.
- `blobModuleUrl(js)` — a `blob:` URL for the module text (revoke it after the import).

TypeScript is a parameter, never an import: the host bundles one TypeScript and hands it in, as
it does for `@nola-lang/derive`'s `useTypeScript()`.
