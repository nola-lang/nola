# Vendored: ts-blank-space

- Upstream: https://github.com/bloomberg/ts-blank-space — tag **v0.9.0**, files `src/index.ts`,
  `src/blank-string.ts` (Apache-2.0, Copyright 2024 Bloomberg Finance L.P.; the headers are kept,
  the repo's LICENSE and NOTICE cover the copy).
- Where: `src/vendor/ts-blank-space/` (`index.ts`, `blank-string.ts`).
- Date vendored: 2026-10-06.
- Why vendored instead of depended on: upstream does `import tslib from "typescript"` at module
  scope, which would pull a SECOND TypeScript into any browser bundle beside the host's own (the
  playground bundles `typescript-web`); the package's rule — shared with `@nola-lang/derive` — is
  that TypeScript is a parameter, never an import.

## Edits vs. upstream (all in `index.ts`, marked `NOLA VENDOR EDIT`; `blank-string.ts` is byte-identical)

1. The `import tslib from "typescript"` line is removed.
6. `import type * as ts from "typescript"` becomes `import type ts from "typescript"` (the
   default-import form), so the factory's `typeof ts` parameter is the module object hosts hand in
   (`import ts from "typescript"` / `typescript-web`) — the namespace form carries a `default`
   member the default-import type does not, and `tsc` refused the call.
2. `const SK = tslib.SyntaxKind` moves from module scope into the factory.
3. Everything from `languageOptions` on — the scanner, the hoisted state and every function — is
   wrapped in `export function createBlanker(tslib: typeof ts): Blanker`, so each TypeScript module
   gets its own scanner and state; `Blanker` is the exported interface of the two public functions.
4. `export default function tsBlankSpace` and `export function blankSourceFile` lose their `export`
   and are returned by the factory.
5. The factory ends with `return { tsBlankSpace, blankSourceFile };`.

No logic changed. The transformation is mechanical (the session's `vendor-blanker.mjs` script did
it from the fetched sources); re-pinning upstream means re-running the same five edits.

biome: the repo's formatter is off, so the file keeps upstream's 4-space layout; three lint rules
upstream does not follow (`style/noNonNullAssertion`, `complexity/useOptionalChain`,
`complexity/noUselessUndefinedInitialization`) are switched off for `src/vendor/**` in `biome.json`.
