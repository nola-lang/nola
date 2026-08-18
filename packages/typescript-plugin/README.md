Part of [Nola](https://github.com/nola-lang/nola), a TypeScript superset (`.tsi`) where `infer` functions and `ask` extractors turn prompts into typed values.

**Internal package** — you probably want [`nola-lang`](https://www.npmjs.com/package/nola-lang) (the dev tool) or [`@nola-lang/runtime`](https://www.npmjs.com/package/@nola-lang/runtime) (the app dependency).

This package is the tsserver plugin that serves `.tsi` files and their companions to TypeScript editors. The Nola VS Code extension loads it automatically.

Versioned in lockstep with the whole toolchain; internal APIs may change in any release.
