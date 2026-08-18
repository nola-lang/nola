# @nola-lang/rspack

Rspack plugin for [Nola](https://github.com/nola-lang/nola) `.tsi` modules.

```js
// rspack.config.mjs
import nola from "@nola-lang/rspack";

export default {
  target: "node22", // Nola is server-only in v0 — browser targets fail with NOLA4001
  resolve: {
    extensions: [".ts", ".js"],
    // NodeNext convention: plain TS written for tsc says "./x.js" while only x.ts is on disk.
    extensionAlias: { ".js": [".js", ".ts"] },
  },
  plugins: [nola()],
};
```

- `nola.config.ts` is auto-wired into the bundle for app targets.
- For `tsc --noEmit` in CI, run `nola declarations` and enable
  `"allowArbitraryExtensions": true` in tsconfig.
