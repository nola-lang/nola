Part of [Nola](https://github.com/nola-lang/nola), a TypeScript superset (`.tsi`) where `infer` functions and `ask` extractors turn prompts into typed values.

**Internal package** — you probably want [`nola-lang`](https://www.npmjs.com/package/nola-lang) (the dev tool) or [`@nola-lang/runtime`](https://www.npmjs.com/package/@nola-lang/runtime) (the app dependency).

This package parses `.tsi` source into the Nola AST. Its published bundle inlines a vendored fork of `@babel/parser` (MIT — see LICENSE for the upstream notice); the fork itself is never published.

Versioned in lockstep with the whole toolchain; internal APIs may change in any release.
