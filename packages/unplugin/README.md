# @nola-lang/unplugin

Universal bundler plugin for [Nola](https://github.com/nola-lang/nola) `.tsi` modules,
built on [unplugin](https://github.com/unjs/unplugin). One transform core serves
Vite, webpack, Rollup, esbuild, and Rspack through subpath exports:

```ts
import nola from "@nola-lang/unplugin/vite"; // or /webpack, /rollup, /rolldown, /esbuild, /rspack
```

Prefer the named wrapper packages (`@nola-lang/vite`, `@nola-lang/webpack`,
`@nola-lang/rollup`, `@nola-lang/rolldown`, `@nola-lang/esbuild`,
`@nola-lang/rspack`) — they re-export these adapters with per-bundler setup docs.

Nola execution is **server-only in v0**: the plugin lowers `.tsi` for server
builds (SSR entries, Node targets) and fails client bundles with `NOLA4001`.
