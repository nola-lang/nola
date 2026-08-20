# AGENTS.md

This file provides guidance to coding agents (Claude Code, GitHub Copilot, etc.) when
working with code in this repository. `CLAUDE.md` and `.github/copilot-instructions.md`
are symlinks to this file.

## What this is

Nola is a TypeScript-superset language (`.tsi`) that lowers to plain TS before any
downstream tool sees it (the JSX model). New syntax → lower → plain TS → normal
toolchain. A configured LLM resolves `` ask ..`prompt` `` extractors at run time.

The authoritative design is the **v2 refactor spec**
`docs/superpowers/specs/2026-07-08-nola-v2-intent-refactor-design.md` (the earlier
`2026-07-04-nola-mvp-design.md` + `plans/2026-07-04-nola-mvp.md` are the historical
MVP, superseded where v2 says otherwise). Read the v2 spec before changing language
semantics — it defines the grammar, lowering, the class-based `Intent<T>` runtime,
and what is deferred (§9–10).

v2 surface at a glance: `infer function name(...)` (optionally
`` name`instruction`(...) ``) declares a nola function that lowers to a plain
function returning a lazy, thenable `Intent<T>`; `ask` resolves intents like
`await` resolves promises (and `await` is legal in infer bodies for ordinary
promises); `ask with <name> <operand>` routes the ask through a named provider
from `nola.config.ts` (static identifier only — NOLA1009 otherwise; lowers to
`__nola.ask`'s third argument, emit contract 3); `` ..`prompt`<T> `` extractors
support `${}` interpolation; `` fn``(...) `` call intents lower to
`FunctionCallingIntent`; since the 2026-08-14 sigil-less spec the empty marker
is optional — a plain call with an Identifier/MemberExpression callee whose
arguments contain a well-formed extractor (directly or nested in plain
object/array literals) is a call intent too, while `` fn`hint`(...) `` remains
the only carrier for instruction text. A call intent AWAITS a thenable callee
result before resolving (`ask` ≈ `await`; type `Awaited<ReturnType<typeof
fn>>`) — a raw promise cannot escape through `ask` anyway (promise
assimilation), and the settled value is what receipts/history/error
attribution need. Consequences, documented in the skill: `.withRetry` re-runs
the callee; the ask timeout bounds provider calls only, not the callee. Phase 1 implements `ExtractIntent` and
`FunctionCallingIntent` only.

## Commands

Node **≥ 22** required. npm workspaces (not pnpm/yarn).

```bash
npm run build      # builds vendored babel-parser FIRST, then `tsc -b` across packages
npm test           # vitest run — whole suite
npm run lint       # biome check .
npx tsc -b         # type-check/build all packages (babel-parser excluded, built separately)
```

Run a subset of tests:

```bash
npx vitest run packages/compiler                          # one package
npx vitest run packages/parser/test/infer.test.ts         # one file
npx vitest run -t "reproduces the spec"                   # by test name
```

Lint/format a subset (biome writes fixes with `--write`):

```bash
npx @biomejs/biome check --write packages/runtime
```

**Tests run from `src`, not `dist`.** `vitest.config.ts` aliases `@nola-lang/*` →
`packages/*/src/index.ts`, so unit tests need no prior build. But the **CLI and
loader run from `dist`** (`packages/nola-lang/dist/main.js`), and the vendored parser must
be built for them — so `nola run/build/check` and the e2e test require `npm run
build` first. The e2e test (`test/e2e/examples.test.ts`) does its own build in `beforeAll`.

## The pivotal constraint (why the architecture is what it is)

Nola is **not lexically valid TypeScript** — `tsc`/`tsserver` throw on `.tsi` before
any plugin runs. So there is no tsc fork and no TS language-service plugin. Instead:

- **We own the parse.** `@nola-lang/babel-parser` is a *vendored fork* of
  `@babel/parser` (v8.0.0-rc.6) with a `nola` internal plugin — the same mechanism
  Babel uses for JSX/TS.
- **Desugar-then-tsc.** `tsc` only ever sees lowered plain TS. `nola check` runs the
  TS compiler API over lowered code and remaps diagnostics back to `.tsi` positions
  via source maps. Verifying that lowered output is tsc-clean is a first-class test
  (`packages/compiler/test/tsc-clean.test.ts`).

Pipeline: `.tsi` → **parser** (Babel fork + nola plugin) → Nola AST → **compiler**
(magic-string span replacement) → plain TS + source map → esbuild type-strip → JS.

## Package dependency order

Build/reason in this order (each depends only on earlier ones):

```
ast, core                    # leaf types + shared utilities (errors, redact, fingerprint); no package deps
  → babel-parser (vendored)  # private, never published
  → parser                   # parseNola(): source → { ast, diagnostics }
  → compiler                 # compileNola(): AST → { code, map, meta, diagnostics }
  → runtime, providers, language-core  # parallel; providers deps ast+core ONLY (never runtime); language-core = compiler + Volar, NO runtime dep
  → node-loader, typescript-plugin  # typescript-plugin: language-core + @volar/typescript
  → nola-lang                # the dev tool users install: nola bin (build/run/check/declarations) + ./register
  → unplugin                 # bundler-plugin core (deps node-loader + nola-lang); adapters via subpath exports
  → vite, webpack, rollup, rolldown, esbuild, rspack, next  # thin wrappers over unplugin; next = withNola + CJS loader bundles
```

Vite-style packaging (spec `docs/superpowers/specs/2026-08-10-vite-style-packaging-design.md`
+ same-day providers amendment): user projects put `nola-lang` in devDependencies and
`@nola-lang/runtime` + `@nola-lang/providers` in dependencies. The config-file import
surface is FROZEN — do not add subpaths or re-exports that fork it:

```ts
import { defineConfig } from "@nola-lang/runtime";
import { openai, mockProvider, withRetry } from "@nola-lang/providers";
```

Everything provider-shaped (factories, resilience combinators, record/replay) lives in
`@nola-lang/providers`; `packages/runtime/test/public-surface.test.ts` pins that the
runtime index does NOT re-export it. `nola-lang` never ships to production — the
built output imports only `@nola-lang/runtime` (running `.tsi` directly in prod
via `node --import nola-lang/register` is the documented tsx-style exception).
Scaffolding (spec 2026-08-12-interactive-init-design.md): `create-nola-lang`
owns the builtin templates (`templates/starter` + `templates/empty`), the
static template registry (`src/registry.ts` — the menu; extract-person is
deliberately absent, the starter IS it), and the shared interactive flow
(`runFlow`; args fill prompts, non-TTY or dir+`--template` means zero
prompts). `npm create nola-lang` runs its bin (`create-nola` is a bin-only ALIAS package —
`npm create nola` — whose bin imports `create-nola-lang/main`; never put
logic there); `nola init` delegates to the
same `runFlow`. Add mode (spec 2026-08-12-add-to-existing-project-design.md):
`--add`, the bare-run cwd `package.json` detection, and the non-empty-target
select all resolve to `addNola` (`src/add.ts`) — writes the empty template's
config (skipped if present) and additively merges runtime/providers/nola-lang
(`^<lockstep>`) + typescript (`^5.6.0`) into the existing manifest; existing
entries are never rewritten, scripts/tsconfig are suggested, never written.
The optional editor step (spec 2026-08-12-ide-setup-design.md): the flow asks
"Set up your editor?" (interactive default VS Code; non-interactive default
none; `--ide vscode|none`), and `writeVscodeSetup` (`src/ide.ts`) writes
guarded `.vscode/launch.json` (the extension's "Nola: Launch File" snippet
resolved to `src/main.ts`, keeping the mandatory resolveSourceMapLocations +
skipFiles invariants) and `.vscode/extensions.json` (recommends
`nola.nola-vscode`) on both the scaffold and add paths — existing files
are skipped with a note, never merged.
Example templates are served from `examples/` on disk inside
this checkout (root manifest name `nola-monorepo`) and from GitHub in
production (Trees API at tag `v<version>`, `main` fallback — release tagging
matters; all files buffer before any write). The curated examples are
scaffold-ready: start/build/check scripts, mock-only configs (the OpenAI smoke
e2e swaps in its own config override in a tmp copy). The published manifest
keeps ZERO runtime deps — `@clack/prompts` is a devDep inlined by
`scripts/bundle.mjs` (root `npm run build` runs it; the dist is an esbuild ESM
bundle). The starter's `nola.replay.jsonl` makes the first run keyless; it is
fingerprint-keyed, so prompt-composition changes fail
`test/e2e/scaffold.test.ts` until the ledger is re-recorded (record over
`mockProvider`, see the plan `docs/superpowers/plans/2026-08-10-scaffolding-phase2.md`).
Publish partition: 12 public, guarded by `test/publish-manifests.test.ts`.

Versioning is LOCKSTEP: every `packages/*` manifest carries the same version, and
internal refs (deps + devDeps naming a workspace package) are EXACT — the exact
pin is what guarantees npm dedupes to one `@nola-lang/runtime` copy (NOLA3002).
Bump with `node scripts/release.mjs <version>` then `npm install` — never edit
versions by hand; `test/publish-manifests.test.ts` enforces the invariant.
(npm workspaces link local packages as long as the range matches the workspace
version, so committed exact versions cost dev nothing. `workspace:*` is not
supported by npm.) When you add a package, give it the current lockstep version,
add it to root `tsconfig.json` `references`, classify it in the publish-partition
test, AND (if the CLI/loader import it at runtime) rebuild.

`comparisons/` is the public marketing proof: the same scenario implemented in Nola
and in each competitor (BAML, LangChain.js, Ax, Vercel AI SDK, plain OpenAI SDK),
plus Figma-editable SVG slides of the numbers. It is deliberately OUTSIDE every
repo-wide mechanism — `workspaces` globs only `packages/*`/`examples/*`, biome's
`includes` and vitest's `include` are allowlists that omit it, and it has no
`tsconfig.json` reference — so root `npm install`, `npm run build`, `npm test`, and
`npm run lint` never touch it. Each project installs on demand in its own folder.
The Nola one depends on the PUBLISHED `@nola-lang/*` from npm (not the workspace
copies) because its whole claim is that it reproduces an outside user's experience;
do not convert it to a workspace or to `file:` links. That also means language
changes do not reach it until you publish — when you do, re-run it and recount the
numbers in `comparisons/inbox-triage/README.md`, which the slides quote.

## Working in the vendored parser (`packages/babel-parser/`)

This is upstream Babel source, pinned. Treat it as read-only **except**:

- `src/plugins/nola/**` — our plugin, edit freely. It hooks `readToken_dot`,
  `parseExprAtom`, `parseMaybeUnary`, `checkReservedWord`, `parseStatementContent`,
  `parseExportDeclaration`, `shouldParseExportDeclaration`, `parseFunction`,
  `parseFunctionParams`, `parseMethod`, `parseFunctionBodyAndFinish`, `isClassMethod`.
  (The `infer function` keyword is claimed only when the token after `infer` is
  `function` — that is what keeps `infer` legal as an identifier and in TS
  conditional types. `parseFunction` adds the Async production flag for infer
  functions so `await` is legal in their bodies.)
- A handful of registration anchors (token table, mixin list) and a build shim.

**Log every edit outside `src/plugins/nola/**` in `packages/babel-parser/VENDOR.md`.**
That file also records the non-obvious facts: it builds with `tsc -p . --noCheck`
(vendored code isn't held to our strict config); Babel's build-time bit-decorator is
replaced by a runtime shim (`src/tokenizer/bit-shim.ts`); the `nola` mixin is
registered **after** `typescript` so it composes on top of it.

Two Babel-8 realities the plugin depends on: the tokenizer never emits a bare
backtick token (a `` ` `` becomes `templateTail`/`templateNonTail`), and `Position`
objects carry an extra `index` field beyond `{ line, column }`.

**The parser tests are normative.** If a vendored hook name differs from what the
plugin expects, adapt the *plugin*, never the test expectations.

## Conventions that will bite you

- **ESM only, NodeNext.** Relative imports in `src` use the `.js` extension even for
  `.ts` files (`import { x } from "./foo.js"`). `verbatimModuleSyntax` is on.
- **Diagnostic codes live in one place:** `Codes` in `@nola-lang/ast`. Parse errors
  `NOLA1xxx`, compile errors `NOLA2xxx`, **runtime errors `NOLA3xxx`** (emit-contract
  and duplicate-runtime guards; config validation 3003–3005). Never invent a code
  inline. Deferred constructs must raise a specific "reserved for a future Nola
  version" error, not a generic syntax error.
- **Positions:** AST `Position` is 1-based line, **0-based** column (Babel). The
  human-facing `loc` string on an `Intent` is `"line:col"` with **both 1-based**;
  from the ask boundary down (receipts, traces, events, `AskContext`, errors)
  file+loc travel as one frozen `Site` value object (`@nola-lang/core` —
  `toString()` → `"file:line:col"`, strict `Site.parse`). Intent inits still
  carry `loc` alone (the file is per-file in `__nola_file_ctx`, met at ask time
  via `frame.sourceFile()`).
- **Two paths, never mixed.** `LowerState.file` is the absolute on-disk path and feeds
  diagnostics and source maps; `LowerState.displayFile` is posix and project-root-relative
  and is the **only** one that may reach emitted code (`file:` fields,
  `__nola.context.file(...)`). Emitting the absolute path bakes the build machine's layout
  into `dist/` and makes builds non-reproducible across checkouts. Callers pass
  `{ sourceRoot }` to `compileNola`; the root is `findProjectRoot()` (nearest
  `nola.config.ts` dir, else the start dir — always absolute, since `displayPathFor`
  prefix-matches it). Nothing at run time resolves `displayFile`: it is a memo key for
  `fileContext` and a label in errors, logs, and receipts.
- **Lowering is byte-identical outside replaced spans.** Only the runtime import and
  the `__nola_file_ctx` accessor are *appended at EOF* (ESM hoists the import;
  `function` declarations hoist with their value) so original line/column positions
  never shift. **No module-level context state is emitted** — `__nola_file_ctx()`
  delegates to `__nola.context.file(path)`, a runtime helper memoized by path. The
  accessor must stay a `function` declaration: as a `const`/`let` it is in its TDZ,
  and as a `var` it is `undefined`, when an infer function is called during its own
  module's evaluation (`const eager = go();`). Within an `ask` over an extractor,
  the ask's trailing insert uses `appendRight` and the extractor's suffix uses
  `appendLeft` at the same position, so the suffix lands *before* the ask's closing
  paren.
- **Underivable `.`-contextual param types follow a configured policy** —
  `compiler.underivableContextType` in nola.config.ts: `"error"` (the default;
  NOLA2008 at the param's type annotation), `"prune"` (lossy derivation drops just
  the underivable members; dead-ref iteration in `Lowerer.pruneDerive`; a type that
  prunes to nothing falls back to omit), `"omit"` (the old silent drop, explicit
  opt-in). The policy governs ONLY that seam: plain params stay silently untyped in
  every mode (their type never describes a live value), extract sites keep NOLA2002,
  companions keep `unsupported()`. Plumbing: `resolveCompilerConfig` (runtime)
  validates the section; `loadCompilerOptions` (node-loader) reads it for
  `build`/`check` WITHOUT demanding a runtime-valid config; `registerNola` loads the
  config before registering the hooks and ships the section to the hooks worker as
  `register` data (so nola.config.ts cannot import `.tsi`). No emit change. The
  editor layer reads it STATICALLY — editor processes never execute user config:
  `staticUnderivableContextType` (compiler) extracts the literal from nola.config.ts
  source (default-export object, defineConfig wrapper, as/satisfies, one identifier
  indirection); `discoverCompilerConfig` (language-core) finds the nearest config
  with an mtime cache and threads it into every editor compile, so config edits
  land on the next recompile. A COMPUTED value is invisible to the editor (falls
  back to the default) while build/check/run see the evaluated truth — keep the
  editor-relevant value literal.
- **Tolerant mode and spans (Track 1, editor groundwork).** `parseNola`/`compileNola`
  accept `{ tolerant: true }`: parse errors record instead of throwing (Babel
  `errorRecovery`; every nola-plugin raise site has an explicit recovery
  continuation), broken constructs (placeholder nodes carrying `nolaError: true`)
  lower to the inert `BROKEN_CONSTRUCT` text — `(undefined as never)`, assignable
  everywhere so it adds no type errors of its own — and diagnostics merge
  parse-then-lower. Strict mode (the default) is byte-identical to the old
  behavior — build/loader/`check` never pass `tolerant`, so nothing ever
  executes a placeholder. The half-typed `..` marker is THE tolerant-mode state
  (it exists on every keystroke between `ask ` and `` ask ..`p` ``) and it has
  its own rules: the parser recovers a lone `.` after `ask` into the same
  placeholder (`nolaIncompleteExtract` — otherwise `parseExprAtom`'s
  `unexpected()` throws through `errorRecovery`, the whole file bails, and the
  editor serves STALE last-good output), and the placeholder's span is kind
  `broken`, which makes `spansToMappings` opt the character AFTER it out of
  completion. That last part is not optional: Volar matches a position against
  any mapping whose range merely ENDS there, so the span in front of the cursor
  cannot hide it, and TypeScript's `isValidTrigger` returns true for `.`
  unconditionally — dot-free generated text does NOT stop it from answering
  with the whole global scope. The marker has a SECOND site: a `.` context
  parameter mid-typing (`infer function f(.`). Since the single-dot spec
  (2026-08-16) the lone dot IS the parameter marker (one dot in, two dots
  out), so `parseBindingElement` claims `tt.dot` at function-param positions
  in both modes; a nameless one leaves the parameter list with nothing to
  bind and `super.parseBindingElement` would reach the same throwing
  `unexpected()`, so it recovers into a placeholder Identifier (`nolaError`,
  name `__nola_incomplete_<offset>`) that `lowerInferFunction` replaces with
  NOTHING under a `broken` span — a parameter list has no inert expression to
  stand in for. NOLA1012 reports it; the retired `..name` spelling is
  NOLA1013 and recovers as contextual; `const .x` is the reserved binding
  form (NOLA1014 — `parseVarId` parks the marker span on the id and the
  lowerer's `VariableDeclarator` case drops it under `broken`; a
  `let`-scoped `chStartsBindingIdentifier` override lets `let .x` reach it).
  On a plain function `.` is NOLA1010 and its bytes survive into the lowered
  output, as before. `CompileResult.meta.spans`
  tiles the generated output (`verbatim` | `replaced` | `broken` | `appendix`)
  and is the ground truth for editor mappings; the v3 source map is derived output.
  `meta.anchors` rides on top of the tiling: source fragments copied
  byte-identically into replacement text (today: the extractor's `<T>` type
  text re-emitted inside `ExtractIntent<T>`) get FULL-feature editor mappings —
  verification included, so a TS2304 inside the anchor reports at the precise
  source range and carries the import quick fix with it. No double-reporting:
  Volar range translation is first-match in mapping-array order and the
  anchored mapping is emitted BEFORE the replaced one (order is load-bearing —
  the anchor's precise translation must beat the replaced span's clamped one).
  The appendix stays unmapped EXCEPT for zero-length import-insertion points
  (`spansToMappings` locates the appendix import statements in the generated
  code): TypeScript's missing-import inserter targets the file's existing
  import group — in a source with no imports that group IS the appendix — and
  the insertion points map pure inserts to source [0,0] while replacements
  never translate, so appendix rewrites can't leak into the source. New
  mutations in `lower()` must go through `SpanRecorder`
  (`packages/compiler/src/spans.ts`), never raw magic-string, or spans drift.
- **`__nola` lowering factories live under `__nola.intents` and mirror the class
  names** — `__nola.intents.Intent(...)` builds an `InvocationIntent` (the
  frame-opening intent an infer function returns),
  `__nola.intents.ExtractIntent(...)`, `__nola.intents.FunctionCallingIntent(...)`
  (no mapping layer; the `Intent` key is kept for emit-surface stability); non-class
  helpers stay lower-case — `__nola.ask`, `__nola.fmt`, `__nola.useRuntime` at the
  top, context accessors under `__nola.context` (since emit 8: `__nola.context.file`,
  was top-level `fileContext`). The classes themselves live in
  `packages/runtime/src/intents/`.
- **Context is a frozen static tree plus one dynamic `Frame` per invocation.**
  `InferContext` (immutable construction lineage: `data`, `parent`, owning
  `runtime`; system → file → function) is written by lowering and never
  copied. `Frame` (`packages/runtime/src/runtime/frame.ts`) is the
  per-invocation activation record: it points at its static node and owns
  everything dynamic — `history`, the ask-span tree (receipts derive from it:
  `AskReceipt` = `AskSpan.toReceipt(...)`), `options` (provider pin /
  `detached`), `invocationId`, and the `parent` link forming the call chain.
  Frames are threaded **explicitly** — the runtime hands the frame to every
  intent executor (`__frame`), and `__nola.ask(value, __frame)` passes it
  back, so **context chains where `ask` happens**; nothing is ambient (no
  AsyncLocalStorage). Roots mint via `Frame.open(infer, options)` — the
  runtime is reached through `infer.runtime`, so the ask path never reads the
  global slot; callees mint `parent.child(...)` (stack-frame semantics: a
  callee's lineage and history read through the caller chain, while
  `sourceFile()` stays the definition site) and collapse to ONE
  `HistoryRecord` on the caller's frame on return; `.detached()` opts a call
  out. Extract and call intents carry NO construction scope and mint NO frame —
  they execute ON the ask-site frame (history and ask spans land there, shared
  across sibling asks); their context node travels to the ask boundary as
  `InferenceRequest.context` instead. Resolving one outside `ask` is a
  definitive `NolaIntentError` (NOLA3010
  IntentWithoutContext). (`InferContext` was previously
  `LlmContext`/`LmContext`; `RuntimeContext` merged into `Frame` — no aliases
  remain.) `onInvocationEnd` fires once per root frame;
  `NolaResolutionError.trace` carries the failing invocation's trace.
- **Fingerprints, cache, record/replay.** Every ask that reaches the terminal is
  stamped with `fingerprintRequest` (`packages/core/src/fingerprint.ts` — in core so
  `@nola-lang/providers`' record/replay can consume it without a runtime dep) —
  sha256 over the canonicalized `{system, messages, output, params}` that crosses
  `NolaProvider.complete`, i.e. exactly what `composeInferParams` produced plus the
  system text. `FINGERPRINT_VERSION` is a compatibility surface — bump it when the
  serialization changes shape (it is 3: v3 hashes the full ProviderOutput and
  ProviderParams; the legacy `fingerprintAsk` shape survives only for tests). The
  fingerprint CACHE is deliberately unwired right now (`cache.test.ts` is skipped;
  see TODO(cache) in `inference.ts`) — the `cache: { store? }` config section
  validates but is not served. `record(inner, path)` / `replay(path)` stay live:
  fingerprinted JSONL ledgers keyed by request fingerprint — replay is strict
  (unknown fingerprint = NOLA3008 definitive error, never a silent live call);
  ledger content is redacted but fingerprints are not (`redactSecrets` eats
  32+-char hex, so never redact a whole ledger line). Any prompt-wording or
  params change re-keys every ledger/cache by content. Codes: NOLA3006
  CacheStoreInvalid, NOLA3007 ReplayLedgerInvalid, NOLA3008
  ReplayFingerprintMismatch.
- **The ask boundary is `Inference`** (`packages/runtime/src/ask/inference.ts`) — a
  per-ask, single-shot strategy object. The base owns span lifecycle, hook events,
  the request fingerprint, the one-correction retry loop, the contract check, and
  receipt emission; subclasses own the wire dialect through four seams:
  `composeInferParams` / `parse` / `validateResult` / `correctionRequest`.
  There is NO strategy-selection layer — each intent constructs its Inference
  directly (`new JsonInference(request)` in ExtractIntent/FunctionCallingIntent).
  `InferenceRequest` = `{frame, site, options, context?}` — `context` is the
  ask-site node composed after the frame chain; there is no separate prompt
  field. The receipt's `originalPrompt`/`effectivePrompt` pair holds the
  COMPOSED conversation (role-labeled transcript): `originalPrompt` as first
  composed, `effectivePrompt` as last sent — they diverge exactly when a
  correction retry ran (and under future middleware rewrites).
- **Prompt composition is polymorphic.** `PromptBuilder` (`ask/prompt-builder.ts`,
  implements the node-facing `InferenceComposer` seam in `ask/composer.ts`) walks
  the frame chain outer→inner, calling `composeInferenceData(composer, opts)` on
  each frame's static node, then on the ask-site node. `FunctionInferContext`
  renders one `CONTEXT` block (signature + file, optional `Purpose:`, argument
  list — plain params as `(value not available)`, long/multiline strings as
  `<value>` blocks); the extract node renders the `TASK` block (`<request>`-tagged
  instruction, inlined `RESPONSE SCHEMA` unless trivially `{type:"string"}`).
  `ComposeOptions` carries frame/builder hints (`nested`, `hasContext`). The
  composed text is fingerprint input — keep it deterministic, land wording changes
  in one commit, and prefer the record/replay eval loop over armchair iteration.
  History does NOT reach the prompt yet (TODO(history) markers in tests).
- **Timeout + provider params ride `IntentOptions`.** `timeout` (ms; 0 disables;
  default `ask.timeoutMs` in config, `DEFAULT_ASK_TIMEOUT_MS` 60s) arms an
  AbortController on the ROOT frame only — every provider call in the invocation
  receives `frame.abortSignal`, `callProvider` fail-fasts via `throwIfAborted`,
  and `frame.settle()` (InvocationIntent's finally) clears the clock. `params`
  (`ProviderParams`: `temperature`, `maxOutputTokens`, `providerOptions`
  escape-hatch) merges per-field along the frame chain nearest-wins
  (`mergeProviderParams` in core — `providerOptions` merges per key), with the
  intent's own `.withParams()` as the nearest override; params join the
  fingerprint.
- **Three retry layers share the `withRetry` name but no code.** Innermost:
  `Inference`'s built-in one-correction loop (semantic — validation failure →
  correction request). Middle: the *provider combinator* `withRetry(provider,
  policy)` (`providers/src/combinators.ts`, for `nola.config.ts` alongside
  `fallback`/`roundRobin`) — retries the single `provider.complete` wire call
  with a `RetryPolicy` (`constant`/`exponential` backoff) and fail-fasts on
  definitive errors via `isDefinitiveProviderError` (explicit flag, or 4xx
  except 408/429); it honors `NolaProviderError.retryAfterMs` (parsed from the
  Retry-After header at the provider throw site) when that exceeds the
  scheduled delay, capped at `policy.maxDelayMs` — a policy with maxDelayMs 0
  ignores the header. Outermost: the *intent method* `.withRetry(retries)`
  (`Askable`/`Intent`) — sets `IntentOptions.retries`, consumed by
  `Intent.runWithRetry`: `retries + 1` flat attempts of the ENTIRE execution
  (composition, provider call, parse, validation, correction loop), no
  backoff and no definitive-error check — it re-attempts errors the combinator
  layer would classify as unretryable (e.g. a 401). Frame
  semantics differ by path: `ask` retries reuse the ask-site frame (spans and
  history accumulate on one invocation), while bare-`await` retries of an
  infer-function intent mint a fresh root frame per attempt (each re-arms its
  own timeout).
- **Intent inits carry no `file`.** Since emit 3 the display path is emitted once
  per file, in `__nola_file_ctx`. The ask boundary derives it at ask time from
  the frame (`frame.sourceFile()`: the static `InferContext` chain first — the
  `FileInferContext` node answers — then the caller frame chain, for scope-less
  extract/call asks); a lineage with no file root anywhere reports `<unknown>`. Since emit 4
  the lowered EOF insert opens with
  `__nola.useRuntime(<NOLA_EMIT>)` (was `__nola.assertEmit(3)` through emit 3; the
  contract is 11 today — since emit 11 the func/extract/call inits accept an
  optional `template` closure and `__nola.tpl` renders it (prompt templates,
  spec 2026-08-17); since emit 10 the appendix imports `@nola-lang/runtime`,
  the real runtime package, not the retired `nola-lang/runtime` brand subpath) —
  it attaches the module to the `NolaRuntime` instance and
  fails at load on a build/runtime skew.
- **Emit 5/6: schemas are `__nola.types` combinator expressions** (`InferType`
  carrier — `packages/runtime/src/types/infer-type.ts`), not inline JSON; since
  emit 7 the ExtractIntent init carries the expression under `type` (was
  `schema` — the carrier is a type, not a JSON schema) and the backtick text
  under `instruction` (was `message` — `instruction` is THE name for authored
  backtick text everywhere: extractors, call intents, the infer-function
  scope; `prompt` stays reserved for the composed provider-facing text). Named
  same-file types lower to hoist-safe `function __nola_type_<Name>()` accessors
  in the EOF appendix (same TDZ rule as `__nola_file_ctx`; they carry an explicit
  `import("@nola-lang/runtime").InferType<unknown>` return annotation because a
  self-recursive accessor has no inferable type — TS7023). Named references emit
  `__nola.types.ref("<Name>", __nola_type_<Name>)` uniformly; recursion is legal:
  `toJsonSchema()` inlines non-cyclic refs (canonically identical to the old
  inline JSON, so fingerprints for old shapes survived the carrier switch) and
  serializes cycles as root `$defs` + `$ref` (validator resolves them;
  `FINGERPRINT_VERSION` is 2). `deriveTypeExpr` (`schema-expr.ts`) is the emit
  path; `deriveSchema` remains as the canonical-equivalence reference and for
  tests. Everything the emitted text references must be exported from
  `@nola-lang/runtime` — `__nola` and, since emit 5, the
  `InferType` type (since emit 6 also `UnsupportedType`). Since emit 9 the
  built-in `Date` derives (only when unshadowed by a local declaration or
  import) to `__nola.types.date()`: wire schema `{ type: "string", format:
  "date-time" }`, validator enforces parseability, and the intent REVIVES the
  validated value post-hoc (`InferType.revive` — ISO string → `Date`
  instance, identity when no date is reachable). Revive is the general
  wire-type ≠ value-type seam; extract sites and call-intent slots both go
  through `ExtractIntent.reviveValue`. Ambient lib types other than `Date`
  (`Map`, `Set`, …) remain underivable.
- **Companions (emit 6): cross-file types.** A type imported from another file
  lowers to `__nola.types.ref("<moduleId>#<Name>", __nola_type_<local>)` plus an
  appendix import `import { <Name> as __nola_type_<local> } from
  "<module>.nola.js"`; `compileNola` reports the specifiers in
  `meta.companions`. `compileCompanion` (`packages/compiler/src/companion.ts`)
  derives the module: hoisted `function __nola_type_<Name>()` accessors
  re-exported under the type's own name, `<Name>` (function declarations
  initialize during ESM instantiation, so circular companions work), refs
  qualified by `<moduleId>#` (posix project-relative, extensionless) so
  same-named types from different files never collide in one `$defs`; bare
  names stay for file-locals (a file cannot both declare and import one
  identifier). **Companions are INTERNAL** — only generated code imports them
  (a plain `<Name>` export needs no user-facing disambiguation, and there is
  deliberately no `$type`-style suffix); user-authored imports of `*.nola.*`
  specifiers are unsupported.
  Underivable exports become `__nola.types.unsupported(reason)` typed
  `UnsupportedType<reason>` — using one is a compile-time TS error carrying the
  reason, or NOLA3009 at run time. The emitted specifier is the entire
  contract: the loader's `resolve` hook probes `companionSourceCandidates` on
  disk and serves the module virtually (`?nola-companion` URL marker);
  `nola build` writes real files into `dist/`; `nola check` injects virtual
  `<dir>/<name>.nola.ts` files that NodeNext `.js`→`.ts` mapping finds —
  no resolver changes. The `*.nola.*` filename namespace is reserved: a real
  on-disk match is NOLA2006 (build/check walk + loader shadow refusal); an
  unlocatable type source is NOLA2007. Type imports should use the NodeNext
  `./x.js` convention (a type-only import never resolves at run time, so no
  on-disk `.js` is needed).
- **Value imports of plain TS also use NodeNext `./x.js`.** Node's native
  type-stripping refuses `.js`→`.ts` mapping, so the loader's `resolve` hook
  retries a failed relative `.js` specifier once with a `.ts` tail — for ANY
  `file:` importer, not just `.tsi` (transitive plain-TS imports break the
  same way one hop deeper). A real on-disk `.js` always wins (the fallback
  runs only after default resolution throws ERR_MODULE_NOT_FOUND), a double
  miss rethrows the original error, and there is deliberately no `.js`→`.tsi`
  mapping: tsc's NodeNext maps `.js` to `.ts`/`.tsx` only, and the runtime
  must not accept what `nola check` rejects (`.tsi` imports keep their
  literal-extension convention).
- **The lowered `__nola` shape is declared in ONE ambient stub** —
  `packages/compiler/src/ambient-stub.ts` (`RUNTIME_AMBIENT_STUB`, mapped to
  `@nola-lang/runtime` in bare projects), imported by `tshost.ts` (`nola check`),
  the tsc-clean test helper, and the headless editor harness. Keep it in lockstep
  with `__nola.ts` and `emit-surface.test.ts` when the emit surface changes.
- **Cross-file consumption of `.tsi`: no adjacent declarations, ever.** `nola build`
  emits declarations ONLY into `--out` (`<name>.tsi.js` + `<name>.tsi.d.ts`, a
  NodeNext pair for consumers of the built output); nothing is written next to
  sources. `nola check` plays the vue-tsc role: the tsconfig's plain `.ts` files
  join the lowered program as roots and their `./x.tsi` imports resolve to the
  LIVE lowered virtuals (tshost's custom resolver) — plain `tsc` over src is NOT
  a supported check path. In the editor, both hosts apply
  `decorateHostHideShadowedDeclarations` (typescript-plugin): an `X.d.tsi.ts`
  with a sibling `X.tsi` is treated as nonexistent, so resolution falls through
  to Volar's extra-extension handling, the `.tsi` is served in-memory, and F12
  from `main.ts` lands on the original infer function. Stale `.d.tsi.ts`
  artifacts are likewise excluded from check roots. Three tsserver invariants,
  all learned the hard way (the protocol e2e `test/e2e/editor-tsserver.test.ts`
  guards them): the typescript-plugin package MUST keep a top-level
  `"main": "./dist/plugin.cjs"` — tsserver resolves plugin packages with
  TypeScript's classic resolver, which reads `main` and IGNORES `exports`, so
  without it the plugin silently never loads; any host
  `resolveModuleNameLiterals` decoration must delegate to the prior resolver
  with ONE batch call carrying the full literal array — per-literal delegation
  desyncs tsserver's resolution-cache bookkeeping (reusedNames correspond to
  literals it did NOT receive) and crashes the server; and every program file
  MUST have a ScriptInfo — tsserver enforces it with Debug asserts in multiple
  places (`ProjectService.setDocument` on every rebuild, freezing diagnostics
  until close/reopen; `Project.getScriptInfos` via project telemetry, which
  killed project load outright on VS Code's TS 6). Synthetic companions
  therefore exist at TWO layers: `decorateServerHostForCompanions` makes them
  real to tsserver's file layer (fileExists/readFile from the on-disk source,
  mtime of the source, watchFile forwarded to the source), and the LS-host
  `getScriptSnapshot` decoration first calls the prior chain so
  `Project.getScriptSnapshot` mints and attaches the ScriptInfo, THEN returns
  the live-snapshot-derived companion text (unsaved edits win).
  `guardProjectServiceDocumentCache` stays as a belt for any remaining
  ScriptInfo-less path (the external document cache is optional; getDocument
  is already null-safe). Deleted-then-recreated `.tsi` imports: Volar
  resolves `.tsi` literals OUTSIDE tsserver's resolution cache, so no
  failed-lookup watcher exists and a re-created file never cleared TS2307 —
  `decorateHostForTsiResolutionWatch` (installed in the plugin's `setup`
  hook, which runs AFTER Volar's host decoration) watches failed relative
  `.tsi` candidates via the ServerHost and invalidates the importing files
  on any event. The watcher is PERSISTENT once armed: after the
  delete/revive cycle the revived ScriptInfo reloads content but no longer
  dirties the project on change, so the same watcher is also the change
  trigger for every later edit of that file. Its
  `hasInvalidatedResolutions` bridge MUST stay an accessor property because
  `Project.updateGraphWorker` reassigns that property on every graph update
  (editor-tsserver-stale-import.test.ts guards the whole cycle). `typescript-vnext` (pinned npm alias of the TS
  major VS Code ships) exists ONLY for `editor-tsserver-vnext.test.ts`, which
  guards the telemetry-assert path with a fixture where the .tsi is NOT a
  tsconfig root (include `src/**/*.ts`) and enters the program through a
  plain-.ts import — the arrangement that put the companion in the program.
- **Editor layer (Track 2).** `@nola-lang/language-core` exposes the lowering as
  Volar virtual code: `createNolaLanguagePlugin<T>(asFileName)` (generic script
  id — tsserver strings, LSP URIs), tolerant `compileNola` per snapshot,
  `meta.spans` → `CodeMapping[]` (verbatim = full features, replaced =
  verification-only, appendix unmapped), `meta.mode === "bailed"` → last-good
  embedded code with `stale = true` and current parse diagnostics on
  `NolaVirtualCode.diagnostics` (Track 3's server reads them). Volar is pinned
  EXACT (2.4.28). Companions in the editor are host-level synthetic scripts —
  `decorateHostWithCompanions` in `@nola-lang/typescript-plugin` — derived from
  the LIVE source snapshot and versioned by it; never VirtualCode. The tsserver
  plugin ships as an esbuild CJS bundle (`npm run bundle` → `dist/plugin.cjs`,
  `typescript` external) because tsserver `require`s plugins; a headless host
  must set `allowNonTsExtensions` itself (tsserver does it implicitly). The
  extraFileExtensions entry's `scriptKind` MUST stay 7 (Deferred) — TypeScript's
  `getSupportedExtensions` drops non-Deferred extras, which silently exiles
  `.tsi` files from tsconfig-include matching into the inferred project.
- **LSP + extension (Track 3).** `@nola-lang/language-server` = Volar server
  runtime + the SAME `createNolaLanguagePlugin` (URI-keyed) +
  `volar-service-typescript` + one nola service plugin publishing
  `NolaVirtualCode.diagnostics` (source "nola"). Volar runs diagnostics plugins
  against EMBEDDED documents when generated code exists — the nola plugin
  decodes the embedded URI and translates source offsets through Volar's mapper
  (`packages/language-server/src/nola-service.ts`). Diagnostics are PUSH-mode
  (volar-service-typescript declares interFileDependencies, which disables the
  pull model) — protocol tests consume `textDocument/publishDiagnostics`
  (`test/e2e/editor-lsp.test.ts`; both e2e files serialize `npm run build`
  through `test/e2e/helpers/ensure-built.ts` — keep using it). v1 feature set:
  diagnostics, hover, completion, definition. Everything the editor host
  `require`s ships as an esbuild CJS bundle wired into `npm run build`:
  tsserver plugin (the `require` condition of `@nola-lang/typescript-plugin`),
  LSP server (`@nola-lang/language-server/server.cjs`), extension
  (`packages/vscode/dist/extension.cjs`). Editor projects MUST use
  directory-style tsconfig `include` (e.g. `["src"]`) so Volar can admit `.tsi`
  while plain tsc ignores it — a `.ts`-suffixed glob (`["src/**/*.ts"]`) keeps
  `.tsi` files out of the program entirely, so they enter only when some plain
  `.ts` already imports them. The visible casualty is auto-import: TS offers
  candidates from files IN the program, so under the glob shape Ctrl+. over an
  unimported infer function offers "Add missing function declaration" instead
  of `Add import from "./x.tsi"` (A/B-verified against a real tsserver — the
  include shape flips that fix on and off, nothing else differs). Every
  shipped tsconfig (scaffold templates + examples) is held to this by
  `test/tsconfig-include.test.ts`; the ONE deliberate exception is
  `test/e2e/fixtures/ts6-companions`, whose whole point is a non-root `.tsi`.
  Debugging: the extension manifest MUST keep
  `contributes.breakpoints` for the nola language (without it VS Code refuses
  the breakpoint gutter in `.tsi` outright); binding then rides the loader's
  inline base64 map (hooks.ts appends it; `sources` is the absolute .tsi path
  in forward-slash form with content embedded — transform.test.ts locks that
  contract) under a plain `node --import nola-lang/register` launch config.
  The infer wrapper's map treatment is TWO-LAYERED and deliberately opposite
  per consumer. Compiler layer: `anchorInsertedLines` (`spans.ts`, after
  `generateMap`) gives every generated line that BEGINS inside replaced text
  a line-start mapping to the edit's source position (opener → function
  header, closer → close-brace line), so `nola build` dist maps and
  `nola check` attribute wrapper positions honestly
  (map-line-anchors.test.ts). Loader layer: `stripWrapperSegments`
  (transform.ts, on esbuild's map BEFORE the remapping merge, where wrapper
  lines are still identifiable via meta.spans) removes those segments again
  PLUS esbuild's line-start carry segments — esbuild opens each output line
  by re-emitting the previous token run, which would otherwise attribute the
  closer line to the body's LAST token (the F11 bug: displayed
  `return valid;` while paused in intent construction). Unmapped wrapper =
  js-debug smart-steps through construction (transform.test.ts locks this).
  The third piece is the runtime: the executor runs in a
  thenable-assimilation microtask V8's async stepping cannot track, so F11
  across the call used to fly to the caller's resumption — the whole
  invocation ran to completion. `InvocationIntent` therefore schedules a
  `console.createTask("nola infer")` at CONSTRUCTION (inside the caller's
  step window) and starts it around the executor; V8's
  `stepInto {breakOnAsyncCall}` pauses at the task start
  (invocation-debug-task.test.ts locks both halves). With all three, ONE F11
  at a call site — `ask fn(...)` in .tsi or bare `await fn(...)` in plain
  .ts — lands on the callee's first body statement, and stepping off the
  body's end exits into the caller. The appendix stays unmapped everywhere —
  which also means stepping off the LAST statement of a `.tsi` entry module
  ends the session cleanly (the module-end pause lands in unmapped appendix
  territory and js-debug walks through it). A plain-`.ts` entry with
  top-level await instead costs one extra F10 that appears to do nothing:
  that is upstream, NOT ours — Node's native type-stripping appends
  `//# sourceURL=…` and emits NO source map (positions are already
  preserved), so V8's module-end pause displays at a phantom position past
  the end of the file. Verified with a control: plain `node` on a `.ts` file
  with TLA and no nola loader in the picture reproduces it identically (a
  `.mjs` shows the same stop at the benign one-past-EOF line). Do not chase
  it in the loader.
  Debug hover over a `.param` works only through the extension's
  EvaluatableExpressionProvider (`evaluatable-expression.ts`, pure logic +
  unit tests): VS Code's built-in fallback keeps dots for `a.b.c` chains, so
  it extracted `.address` — a syntax error under evaluate — and showed
  nothing; the provider drops the contextual marker and keeps chains. The
  other half is closure capture: the wrapper opener emits a `void <param>;`
  read per named param (templates.ts `invocationOpen`) because V8 drops
  variables the executor never references — without it, evaluate on a param
  the body doesn't mention throws ReferenceError and the hover is empty
  (one statement per param; a comma expression is TS2695 under strict).
  Launch configs MUST widen `resolveSourceMapLocations` to
  `["${workspaceFolder}/**", "!**/node_modules/**"]` (the snippet does) —
  VS Code's injected default only admits `**/*.(m|c|)js`, which rejects the
  .tsi script's inline map and makes stepping display generated (shifted)
  lines. Launch configs MUST also set `skipFiles`
  (`["<node_internals>/**", "**/node_modules/**"]` — the snippet does); it
  earns its keep twice. First, V8's async stepping surfaces inside the
  runtime's ask machinery when a stepped-over frame suspends, and skipFiles
  makes js-debug walk through those frames so F10 stays in the `.tsi`.
  Second, without it F10 over the process's FIRST network ask dies entirely
  (step becomes continue): js-debug wraps WebAssembly.compile with an
  injected `debugger;` statement, undici lazily compiles llhttp WASM during
  that first fetch, and js-debug's auto-resume of its own mid-step pause
  cancels V8's pending step (js-debug defect, race-dependent); with skipFiles
  the stepping survives (verified in VS Code — a loader-side prewarm fetch
  existed briefly for this and was removed as redundant). In THIS monorepo the runtime
  resolves through workspace symlinks to `packages/*/dist` (outside
  node_modules), so dogfood configs need `"**/packages/*/dist/**"` as well —
  do NOT put that in the user-facing snippet (it would skip a user's own
  monorepo dist output). Dogfood via F5 ("Run Nola Extension"); the manual
  smoke checklist lives in `packages/vscode/DEVELOPMENT.md` (the README is the
  Marketplace page). Marketplace: publisher `nola`, extension version has its
  OWN plain x.y.z line (lockstep-exempt — the Marketplace rejects prerelease
  suffixes; release.mjs skips it), and `npm run package -w nola-vscode` builds
  a self-contained VSIX (local dist/server.cjs, workspace-or-builtin tsdk,
  tsserver plugin staged under node_modules — vsce dependency mode is the only
  route that packs node_modules files).
- **Prompt templates (spec 2026-08-17-prompt-templates-design.md).** Inside
  ANY instruction literal (marker, extractor prompt, call hint) a hole that
  starts with a single dot — `${.member}` — is a `NolaScopeAccess` (parser:
  `nolaTemplateStack` in `parseTemplate`; every enclosing literal gets
  `nolaHasScopeAccess`); other holes stay lexical. A flagged literal is a
  TEMPLATE: the compiler emits `instruction: "<raw>", template: (__nola_s)
  => __nola.tpl\`…\`` — extractor in place (`__nola_s` inserted before each
  scope dot), marker/call hint copied into the wrapper closer / args head
  with ANCHORS (`templateCopy`, `SpanRecorder.appendLeft` anchors) so the
  editor completes after `${.`; a lexical-only marker/hint becomes a
  `__nola.fmt` template literal (NOLA1008/2005 retired). Runtime:
  `PromptBuilder` is a continuation walk (`ComposeOptions.next`,
  `contributesText()`); nodes build `FunctionPromptScope` /
  `ExtractPromptScope` over their PromptData and call `renderTemplate` —
  unread `.next` (function) / `.format` (extractor) is appended (safe by
  default), `.default` is the built-in block, empty/throwing template =
  NOLA3014. `instruction` stays a string everywhere (history, describe,
  errors). Codes: NOLA1015 (tolerant `${.` placeholder — lowers to
  `__nola_s.` so TS still completes), NOLA2009 (scope access outside a Nola
  literal), NOLA2010 (Nola construct in a copied hole). Emit 11.
- **`__nola`-prefixed identifiers are reserved** in `.tsi`; `ask` is a reserved word
  there (but legal as a member/property name). `infer` is contextual — only a
  keyword directly before `function` at statement/export position.
- **Bundler plugins (spec 2026-08-14-bundler-plugins-design.md).** One unplugin
  factory (`packages/unplugin`) serves Vite/webpack/Rollup/esbuild/Rspack; the
  named packages are ~2-line re-exports. `transformTsi` = `transformNola` + an
  EOF `import "virtual-nola-config?path=<config>"` for app targets — the wiring
  id is SCHEME-LESS on purpose (webpack routes URI-scheme requests past
  enhanced-resolve, bypassing unplugin's resolver) and carries the config path
  as a query param so `load` needs no shared state; the wiring module imports
  the user's nola.config.ts as a normal specifier (bundler bundles the config
  graph, watch/HMR included). Companions are `\0nola-companion:<abs source>`
  virtuals (NOLA2006/2007 parity with the loader). Server-only enforcement is
  layered: Vite's per-transform `ssr` flag and webpack/Rspack
  `compiler.options.target` (checked at apply, raised at transform) yield
  NOLA4001; the runtime backstop (NOLA3013, `Inference` constructor) catches
  everything else — including Turbopack's client side. `declarations`
  (default on for app targets) runs `emitAdjacentDeclarations` scoped to the
  project root of the first `.tsi` actually transformed — NEVER process.cwd(),
  which under a monorepo-rooted bundler API call would spray d.tsi.ts across
  every workspace .tsi (buildStart emits only for an explicit `options.root`):
  adjacent `<base>.d.tsi.ts` files that `allowArbitraryExtensions` resolves —
  the one sanctioned exception to "no adjacent declarations" (the editor
  already hides them next to a live .tsi; `nola check` excludes them;
  gitignored). `@nola-lang/next`'s `withNola` applies the unplugin webpack
  plugin to SERVER compilations only, a throwing client-error loader
  otherwise, sets `serverExternalPackages: ["@nola-lang/runtime"]`, and maps
  `*.tsi` through a standalone Turbopack loader — a CJS esbuild bundle that
  INLINES the config wiring (Turbopack has no virtual modules) and reads
  `underivableContextType` via `staticUnderivableContextType` (loaders never
  evaluate user config).
- **Config distribution (spec 2026-08-11-config-distribution-design.md):**
  `nola.config.ts` is evaluated as a BUNDLE everywhere it is executed —
  `bundleConfig` (node-loader) inlines relative/tsconfig-path imports
  (middleware/hooks in src) and keeps bare package specifiers external; a
  `.tsi` in the config graph is NOLA3012. App builds (`build.target` "app",
  the default) emit a self-configuring `<out>/nola.config.js` and `build.ts`
  appends `import "<rel>/nola.config.js"` to each lowered module AFTER
  compileNola — the compiler, declarations pass, loader, editor, and check
  never see that import, so the emit contract is untouched. `build.target:
  "lib"` (and config-less projects) skip all wiring: libs are configured by
  the consuming app's process. `.env` stays a dev-loader convenience; prod
  reads the real environment.
- **Agent skill content is part of the language surface.**
  `packages/create-nola-lang/skills/nola/**` (SKILL.md + references) teaches
  coding agents to write Nola; `nola skill install` / the init flow write
  SELF-CONTAINED, version-stamped copies into user projects (claude gets the
  whole directory; cursor/copilot/AGENTS.md embed SKILL.md's body inline —
  the pointer-into-node_modules form was reversed 2026-08-20). It lives in
  create-nola-lang because that package has zero deps and is the only one
  present on both the scaffold and `nola skill install` paths. Any change to
  user-facing language or config surface updates the skill content in the
  same commit; `nola skill install --force` re-stamps existing projects.
  Spec: docs/superpowers/specs/2026-08-14-agent-skill-distribution-design.md.
- **`Intent` is a class internally; the PUBLIC types are two interfaces.** The
  runtime classes (lazy + thenable + single-shot) stay rich, but the
  `__nola.intents.*` factories declare the narrow tiers from `@nola-lang/core`
  so class internals (`run`, `spec`, `reviveValue`, `then`, `__nolaBrand`)
  never reach user completion: `Askable<T>` (raw extract/call intents —
  `withRetry`/`withProvider`/`withParams` only; not thenable, since bare await
  throws NOLA3010, and no root-only knobs) and `Intent<T> extends Askable<T>,
  PromiseLike<T>` (infer-function returns — adds `withTimeout`/`detached`).
  `Askable`'s T is deliberately phantom — do NOT add an anchor member, even
  symbol-keyed (TS shows symbol members in completion; the LSP e2e guards
  this); `ask` infers T from the type reference. `__nola.ask` takes
  `Askable<T>` → `Promise<T>`, so asking a non-intent is a compile error.
  The `__nolaBrand: "nola.intent"` string lives as an instance property for
  duplicate-package detection (the `isIntent()` function checks the brand, not
  `instanceof`; the class itself is no longer index-exported — the runtime
  index exports the interfaces under `Intent`/`Askable`).
  Intents are **not** JSON-serializable (they hold an executor closure) — the MVP
  serializability requirement was dropped. There is NO seeding API:
  `.withContext({...})` was dropped entirely (2026-07-16, after the MVP's
  `IntentContext` last parameter before it) — context enters a nola function
  only through `.`-contextual parameters (`.name`, one dot; the extractor keeps two).
- **The runtime is one entity: `NolaRuntime`.** The process-wide slot
  (`globalThis[Symbol.for("nola.runtime")]`) holds a `NolaRuntime` instance — claimed at
  runtime-module import (duplicate incompatible copies fail there, NOLA3002). It owns the
  resolved config, provider resolution, hook dispatch (+ warn-once ledger), and the
  `fileContext` memo; `nolaRuntime.reset()` discards the instance wholesale. Config **latches on the
  first ask**: `nolaRuntime.configure()` may be called freely before it, throws `NolaConfigError`
  after it (a failed unconfigured ask does not latch). Routing precedence, highest first:
  `forceProvider` → a middleware `ctx.provider` reassignment → the ask-site pin
  (`ask with <name>` / `.withProvider()`) → `providers.default`.
  `NolaRuntime.resolveProvider(ref?)` owns that ladder — never read the provider map
  directly. `plugins` is the only remaining reserved config key.
- **Hooks observe; middleware is currently UNWIRED.** Events are emitted from fixed
  points in `Inference` so hooks can never miss an ask: `askEnd` always fires with a
  receipt. A throwing hook is swallowed and warned about once per hook+method. The
  middleware pipeline (`ask/pipeline.ts`, the `middleware` config section, the
  `ask-middleware.test.ts` suite — skipped) is infrastructure kept for
  re-introduction, but the ask path calls its terminal directly today; when it
  returns, a throwing middleware fails the ask and `ctx.provider` reassignment
  re-enters the routing ladder. `AskContext`'s runtime-owned fields (`askId`,
  `site`, `abortSignal`) are `readonly` *and* non-writable, so mutating them is a
  compile error and a `TypeError`. Anything logged or persisted into a receipt goes
  through `redactSecrets`/`redactError` — provider error bodies echo key
  fingerprints.
- **`@ampproject/remapping`** resolves as a CJS namespace under our TS config though
  the runtime default is callable — import via the typed-cast pattern already in
  `transform.ts`/`build.ts`, and chain the two source maps with a one-shot loader
  (both maps share the same source filename, so name-matching would recurse forever).
- **User-facing documentation lives in `docs-site/` and is PUBLIC.** It is the
  source for nola.sh/docs; nola-website consumes it through its
  `scripts/sync-docs.mjs`, which copies it **verbatim** — the copy there is
  generated and must never be edited. Because the sync performs no transform,
  these files are exactly what Starlight builds: keep them that way. The
  contract is `docs-site/README.md` — frontmatter exactly
  `title`/`description` (50–160 chars)/`sidebar.order`, internal links
  site-absolute with a trailing slash (`/docs/language/ask/#anchor`), component
  imports only from `@astrojs/starlight/components`, error-code headings the
  bare code. Because it ships to the public mirror it must never cite `docs/` —
  the specs, plans and internal notes there are withheld.
  `test/docs-site.test.ts` enforces the contract and resolves every internal
  link, `test/docs-error-codes.test.ts` pins code coverage, and
  `node scripts/check-docs.mjs` compiles every `tsi` fence against the workspace
  build. A change to user-facing language or config surface updates `docs-site/`
  in the same commit, exactly as it updates the agent skill.

## TDD workflow

Every change follows the plan's rhythm: write the failing test, see it fail,
implement the minimum, see it pass, then `npx tsc -b`, `biome check --write`, and
commit. Commit after each green step; keep commits scoped to one package/feature.
