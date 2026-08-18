# @nola-lang/rollup

Rollup plugin for [Nola](https://github.com/nola-lang/nola) `.tsi` modules.

```js
// rollup.config.mjs
import nola from "@nola-lang/rollup";

export default {
  input: "src/main.ts",
  plugins: [nola()],
  external: (id) => id.startsWith("@nola-lang/"),
};
```

Aimed at library authors: pass `nola({ target: "lib" })` to skip config
auto-wiring — the consuming app configures the Nola runtime. Nola execution is
server-only in v0.

For `tsc --noEmit` in CI, run `nola declarations` and enable
`"allowArbitraryExtensions": true` in tsconfig.
