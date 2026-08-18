# Vendored @babel/parser

- Path chosen: **A** (Babel 8 RC TypeScript source, built with our tsc)
- Upstream version/tag: **v8.0.0-rc.6** (github.com/babel/babel, sparse checkout of `packages/babel-parser/src`)
- Date vendored: 2026-07-04
- Build: `tsc -p . --noCheck` with `rewriteRelativeImportExtensions` (source uses explicit `.ts`
  relative imports; tsc 5.7+ rewrites them to `.js` in the ESM emit). Type-checking is skipped —
  vendored code is not held to our strict config; residual diagnostics are upstream's business.
- Runtime deps: `@babel/helper-string-parser@8.0.0-rc.6`, `@babel/helper-validator-identifier@8.0.0-rc.6`,
  `charcodes`; `@babel/types@8.0.0-rc.6` is type-only.
- Public surface: hand-written `types/index.d.ts` (only `parse()` is exposed to the monorepo).

## Changes vs. upstream v8.0.0-rc.6

The change surface splits into **new files we own** and **minimal anchor edits** into
otherwise-untouched upstream files. No upstream *logic* was modified — that is what keeps
re-pinning Babel cheap. In-code edits are marked with a `// NOLA VENDOR EDIT` comment, so
`grep -rn "NOLA VENDOR EDIT" src` re-derives this table if line numbers drift.

### New files (ours, don't exist upstream)

| File | Lines | What it is |
|---|---|---|
| `src/plugins/nola/index.ts` | ~157 | The Nola plugin — the whole language extension. A mixin over the TS parser (owned by us, edit freely). |
| `src/tokenizer/bit-shim.ts` | ~42 | Runtime standard-decorator implementation of `@bit`, replacing Babel's build-time `babel-plugin-bit-decorator`. Identical bitfield-packing into `State#flags`, so whole-state save/restore through `flags` behaves exactly like Babel's own build. |
| `types/index.d.ts` | — | Hand-written public surface. Only `parse()` is exposed to the monorepo. |
| `VENDOR.md` | — | This file. |

### Edits into upstream files (kept minimal, tracked)

| File | Location | Change | Why |
|---|---|---|---|
| `src/tokenizer/state.ts` | L18–19 | `declare const bit` → `import { bit } from "./bit-shim.ts"` | Babel's `bit` is a build-time decorator; we don't run their build, so we swap in the runtime shim (same semantics). |
| `src/tokenizer/types.ts` | L337–339 | Appended `nolaDotDot: createToken("..", …)` to the `tt` token table | New `..` token for the `ask ..` extractor. Appended **last**, after all range-helper upper bounds, so every `token <= tt.X` guard excludes it. |
| `src/plugin-utils.ts` | L146–147, L153–160, L170–172 | Registered the `nola` mixin in `mixinPlugins` (after `typescript`) and added `"nola"` to the `mixinPluginNames` union cast | Wires the plugin into the parser-class factory. Order matters — `nola` composes *on top of* `typescript`. |
| `tsconfig.json` | `compilerOptions` | `sourceMap: false → true` | Emits `dist/*.js.map`. The CLI/loader run the parser from `dist`, so without maps VSCode can't bind breakpoints in `src/plugins/nola/**` during a `nola run` debug session. `--noCheck` still emits maps; runtime is unaffected. |

### What the plugin overrides

`src/plugins/nola/index.ts` hooks eight upstream parser methods (adapting, never forking, their internals):

`readToken_dot`, `parseExprAtom`, `parseMaybeUnary`, `checkReservedWord`, `parseFunctionParams`,
`parseMethod`, `parseFunctionBodyAndFinish`, `isClassMethod`.

## Notes for consumers

- Babel 8 `Position` objects carry `{ line, column, index }` — the extra `index` (byte offset)
  is beyond the spec's `{ line, column }` Position contract but harmless and structurally
  compatible. Node `.start`/`.end` byte offsets are the primary offsets Nola uses.
- The tokenizer never emits a standalone backtick token: a `` ` `` is read by
  `readTemplateToken()` into `templateTail` / `templateNonTail`. The nola plugin matches those,
  not a `backQuote`.

- 2026-08-10: added LICENSE (upstream Babel MIT text, Copyright (c) 2014-present Sebastian McKenzie and other contributors) at the package root for vendor compliance; @nola-lang/parser restates it in its own LICENSE since its published bundle inlines this fork.
- 2026-08-15: the repo relicensed MIT → Apache-2.0. This package is exempt: its LICENSE stays upstream Babel's MIT text (vendored code keeps its original license), and @nola-lang/parser's LICENSE is now Apache-2.0 for Nola's code with the Babel MIT notice appended for the bundled fork. The root NOTICE file also names the fork.
