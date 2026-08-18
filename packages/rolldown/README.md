# @nola-lang/rolldown

Rolldown plugin for [Nola](https://github.com/nola-lang/nola) `.tsi` modules.

```js
// rolldown.config.mjs
import nola from "@nola-lang/rolldown";

export default {
  input: "src/main.ts",
  platform: "node", // Nola is server-only in v0
  plugins: [nola()],
  external: (id) => id.startsWith("@nola-lang/"),
};
```

- `nola.config.ts` is auto-wired into the bundle for app targets; pass
  `nola({ target: "lib" })` for libraries (the consuming app configures the
  Nola runtime).
- For `tsc --noEmit` in CI, run `nola declarations` and enable
  `"allowArbitraryExtensions": true` in tsconfig.
