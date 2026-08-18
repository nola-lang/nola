# @nola-lang/vite

Vite plugin for [Nola](https://github.com/nola-lang/nola) `.tsi` modules.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import nola from "@nola-lang/vite";

export default defineConfig({
  plugins: [nola()],
});
```

Nola execution is **server-only in v0**: `.tsi` transforms for SSR environments
(`vite build --ssr`, SSR dev). A client bundle importing `.tsi` fails the build
with `NOLA4001` — move the import behind a server boundary.

- `nola.config.ts` is auto-wired into the bundle for app targets (the config
  graph is bundled by Vite itself, so config edits hot-reload).
- For `tsc --noEmit` in CI, run `nola declarations` and enable
  `"allowArbitraryExtensions": true` in tsconfig so plain tsc resolves `.tsi`
  imports through the generated `*.d.tsi.ts` files.

Options (`nola(options)`): `target` (`"app" | "lib"`), `config` (path override
or `false` to disable wiring), `declarations` (emit `d.tsi.ts` during the build,
scoped to the project root of the `.tsi` files being bundled).
