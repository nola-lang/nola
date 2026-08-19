# @nola-lang/runtime

The runtime half of [Nola](https://github.com/nola-lang/nola) — the one
package a Nola app depends on in production. Lowered `.tsi` code imports it,
and `nola.config.ts` gets `defineConfig` from it:

```ts
import { defineConfig } from "@nola-lang/runtime";
import { openai } from "@nola-lang/providers";

export default defineConfig({
  providers: { default: openai() },
});
```

Public surface: `defineConfig`, the `Intent<T>`/`Askable<T>` types, the
`NolaError` family, redaction helpers, and the runtime configuration API.
Provider factories live in
[`@nola-lang/providers`](https://www.npmjs.com/package/@nola-lang/providers);
the dev toolchain (`nola` CLI, loader) is
[`nola-lang`](https://www.npmjs.com/package/nola-lang). The scaffold
(`npm create nola`) wires all three.
