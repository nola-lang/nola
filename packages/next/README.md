# @nola-lang/next

Next.js integration for [Nola](https://github.com/nola-lang/nola) `.tsi` modules.

```js
// next.config.mjs
import { withNola } from "@nola-lang/next";

export default withNola({
  // your Next config
});
```

What `withNola` wires up:

- **webpack mode:** `.tsi` lowering in server compilations (via
  `@nola-lang/unplugin`), including auto-wiring `nola.config.ts` and emitting
  the adjacent `*.d.tsi.ts` declarations that `next build`'s type check needs.
- **Turbopack:** a `*.tsi` rule through the bundled loader (`next dev --turbopack`).
- **Client guard:** importing `.tsi` from client code fails with `NOLA4001` —
  Nola is server-only in v0. Use server components, route handlers, or server
  actions.
- **Runtime singleton:** adds `@nola-lang/runtime` to `serverExternalPackages`.
- **NodeNext resolution:** `resolve.extensionAlias` for `./x.js` → `x.ts`.

Enable `"allowArbitraryExtensions": true` in your `tsconfig.json` so tsc
resolves `.tsi` imports through the generated declarations, and gitignore
`*.d.tsi.ts`.
