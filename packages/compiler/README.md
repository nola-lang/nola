Part of [Nola](https://github.com/nola-lang/nola), a TypeScript superset (`.tsi`) where `infer` functions and `ask` extractors turn prompts into typed values.

**Internal package** — you probably want [`nola-lang`](https://www.npmjs.com/package/nola-lang) (the dev tool) or [`@nola-lang/runtime`](https://www.npmjs.com/package/@nola-lang/runtime) (the app dependency).

This package lowers Nola constructs to plain TypeScript (the JSX model): byte-identical outside replaced spans, source maps, schema derivation, and companion modules for cross-file types.

Versioned in lockstep with the whole toolchain; internal APIs may change in any release.
