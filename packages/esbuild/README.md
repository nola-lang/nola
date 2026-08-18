# @nola-lang/esbuild

esbuild plugin for [Nola](https://github.com/nola-lang/nola) `.tsi` modules.

```js
import { build } from "esbuild";
import nola from "@nola-lang/esbuild";

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outdir: "dist",
  plugins: [nola()],
});
```

With tsup:

```ts
// tsup.config.ts
import { defineConfig } from "tsup";
import nola from "@nola-lang/esbuild";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  esbuildPlugins: [nola()],
});
```

Nola execution is server-only in v0 (`platform: "node"`). For `tsc --noEmit`,
run `nola declarations` and enable `"allowArbitraryExtensions": true`.
