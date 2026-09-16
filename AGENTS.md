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
promises); `ask with <name> <operand>` routes the ask through a named model
from `nola.config.ts` (static identifier only — NOLA1009 otherwise; lowers to
`__nola.ask`'s third argument, emit contract 3; when the platform serves
inference — `model: nola.infer()` — an UNCONFIGURED
name is legal and rides the request as a free-form `profile` for the
platform, see the routing bullet below); `` ..`prompt`<T> `` extractors
support `${}` interpolation; `` fn``(...) `` call intents lower to
`FunctionCallIntent`; since the 2026-08-14 sigil-less spec the empty marker
is optional — a plain call with an Identifier/MemberExpression callee whose
arguments contain a well-formed extractor (directly or nested in plain
object/array literals) is a call intent too, while `` fn`hint`(...) `` remains
the only carrier for instruction text. A call intent AWAITS a thenable callee
result before resolving (`ask` ≈ `await`; type `Awaited<ReturnType<typeof
fn>>`) — a raw promise cannot escape through `ask` anyway (promise
assimilation), and the settled value is what receipts/history/error
attribution need. Consequences, documented in the skill: `.withRetry` re-runs
the callee; the ask timeout bounds provider calls only, not the callee. Phase 1 implements `ExtractIntent` and
`FunctionCallIntent` only.

## Commands

Node **≥ 22.18** required (plain `.ts` runs on Node's native type stripping, on by default only from 22.18 — the scaffolder warns on older Nodes, see `create-nola-lang/src/node-version.ts`). npm workspaces (not pnpm/yarn).

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
  → compiler                 # compileNola(): AST → { code, map, meta, diagnostics } — PHASE 1 (inert accessors + meta.derivations) + finalizeDerivations; no TypeScript, no node:path
  → derive                   # deps compiler + typescript (>=5.6 <7): the checker walk (deriveType), answerRequests, DerivationService (one ts.LanguageService per process), derivationDiagnostics
  → console                  # deps core only: node:sqlite storage + Hono API (`nola console`); serves dist/ui — it has NO UI source
  → console-ui               # PRIVATE SPA (React, react-router, TanStack Query+Table, shadcn/ui = Tailwind v4 + radix-ui, Recharts, lucide-react); `npm run bundle -w @nola-lang/console-ui` type-checks (own tsconfig, outside `tsc -b`) and builds INTO packages/console/dist/ui; src/components/ui/** is `npx shadcn add` output kept upstream-identical (biome overrides exempt it); the palette lives ONLY in src/index.css (original amber/panel/mono tokens mapped onto shadcn names — keep the look)
  → runtime, providers, language-core  # parallel; providers deps ast+core ONLY (never runtime); the runtime renders for classic providers (they receive a ClassicPrompt), only the platform model gets the InferenceModel — its `/v1/infer` client lives IN the runtime (src/platform-model.ts) behind `nola.infer()` (config v2 2026-09-08); language-core = compiler + Volar, NO runtime dep
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
import { defineConfig, nola, terminalTrace } from "@nola-lang/runtime";
import { openai, mockProvider, withRetry } from "@nola-lang/providers";
```

Everything bring-your-own (vendor factories, resilience combinators, record/replay)
lives in `@nola-lang/providers`; `packages/runtime/test/public-surface.test.ts` pins
that the runtime index does NOT re-export it. The naming rule (platform-config
design 2026-09-03): the PROVIDER is the vendor (`openai`), the MODEL is the
configured instance (`openai("gpt-5")`) — the config slot is `model`
(`forceModel`, `.withModel()`, `LanguageModel` is the instance type users
implement), while everything about the vendor wire keeps "provider"
(`onProviderRequest`, `ProviderRequest`, `NolaProviderError`, the package).
The platform enters like any vendor, by slot (config v2 spec
2026-09-08, superseding the 09-03 entry points): `nola` (`src/nola.ts`) is a
FROZEN NON-CALLABLE namespace — `nola.infer(model?)` is `platformModel`
(`src/platform-model.ts`, the `/v1/infer` client; absent ⇒ the platform
chooses, a string ⇒ the upstream selector, an object ⇒ `PlatformOptions` +
`model`; `PLATFORM_MODEL`-branded, the ONLY `infer`-dialect model, legal
only as the bare `model` or the map's `default`), and `nola.tracer(target?)`
is the ungated tracer (absent target ⇒ `NOLA_API_URL` → api.nola.sh). There
is no `nola()` call: the callable preset is reserved for a later design.
`defineConfig` is the only root and `model` is always required. `nola-lang` never ships to production — the
built output imports only `@nola-lang/runtime` (running `.tsi` directly in prod
via `node --import nola-lang/register` is the documented tsx-style exception).
Scaffolding (spec 2026-08-12-interactive-init-design.md): `create-nola-lang`
owns the builtin templates (`templates/starter` + `templates/empty`), the
static template registry (`src/registry.ts` — the menu; extract-person is
deliberately absent, the starter IS it), and the shared interactive flow
(`runFlow`; args fill prompts, non-TTY or dir+`--template` means zero
prompts). The `nola` bin is a COMMAND TABLE (`nola-lang/src/commands.ts`: one
`defineCommand` entry per command, each with its OWN parseArgs option map)
routed by the zero-dep dispatcher in create-nola-lang (`src/cli.ts` —
generated help, `--help`/`--version`, per-command flag scoping); `nola init`
and the create bin declare their flags once as `FLOW_OPTIONS` (flow.ts). A
new command is one table entry, never a switch case.
`npm create nola-lang` runs its bin (`create-nola` is a bin-only ALIAS package —
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
are skipped with a note, never merged. The builtin templates' `src/main.ts`
opens with a `__NEXT_STEPS__` placeholder that `scaffold({ ide })` renders
(`nextStepsComment` in scaffold.ts): the VS Code variant — F5, a breakpoint
in `src/person.tsi` (or "your .tsi file" for `empty`), the recommended
extension — ONLY when the editor was chosen, since the `.vscode` files are
what make it true; otherwise an editor-neutral `npm start` + editor-setup
docs link. Examples from `examples/` are copied verbatim and carry none. The
install-and-open step opens `code <dir> <dir>/src/main.ts` (`vscodeArgs`,
launch.ts: the folder becomes the workspace, the file the active editor) so
the user lands on that comment instead of an empty window.
The provider step (2026-09-08, reshaping the trial step of spec
2026-08-24-trial-onboarding-design.md): right after the template,
`resolveExtras` asks `PROVIDER_QUESTION` ("Select an inference provider:"),
a select over the static `PROVIDERS` menu (`src/providers.ts`, sibling of
the template registry): `nola` first and highlighted, then `openai` /
`anthropic` / `google` (label "Gemini"), then `none` ("Skip for now"). It
is asked BEFORE the editor/agents setup. `--provider <id>` answers it;
`--trial` / `--no-trial` (`parseArgs allowNegative`) stay as shorthands for
`nola` / `none` and a disagreeing pair throws; the non-interactive default is
`none` — the e2e suites depend on that. `FlowOutcome.provider` is a
`ProviderId` (was `trial: boolean`). A vendor choice writes
`templates/_providers/<id>.config.ts` over the template's `nola.config.ts`
(`scaffold({ provider })`, `providerConfigUrl`), skips the starter's replay
ledger, renders vendor README notes naming the env var (`OPENAI_API_KEY` /
`ANTHROPIC_API_KEY` / `GEMINI_API_KEY`), and the outro says "set <ENV> in
.env first" — no key prompt, no network. The add path passes the provider to
`addNola({ provider })`: a vendor config is written when the project has
none, otherwise the skipped note names the `model:` line. Only `nola` runs
the key ladder: `runFlow` calls `obtainTrial` BEFORE writing files, a note-on-failure
wrapper over `acquireKey` (`create-nola-lang/src/key.ts`, spec
2026-09-04-cli-sign-in-design.md): a stored Auth0 session in
`~/.nola/credentials.json` (`src/credentials.ts`, version 1, mode 0600,
`{ version: 1, sessions: { [apiUrl]: { accessToken, refreshToken, expiresAt,
email } } }`; refreshed by `accessTokenFor` when stale; an unparsable or
unknown-version file is left alone, no migration) → `POST /v1/console/keys` `{ name: "cli" }`; no
session but a `config.json` account for the API URL (this machine used its
one anonymous trial) → interactive: the Auth0 Device Authorization Grant
(`src/auth.ts`: tenant from `GET /v1/capabilities` `auth: { issuer,
clientId, audience }`, `POST {issuer}/oauth/device/code`, poll
`/oauth/token`, URL + code noted, browser via `openBrowser` — `NOLA_NO_BROWSER`
disables it — then `writeSession`), non-interactive: `SignInRequiredError`
("Sign in with `npx nola-lang login`"); neither → `POST /v1/trial`
(`requestTrial`, `src/api.ts`, zero-dep global-fetch client, `NOLA_API_URL`
override, `user-agent: create-nola-lang/<version>`) with an EMPTY body —
nothing on the machine identifies it to the server — recorded in
`~/.nola/config.json` (`src/home-config.ts`: `{ version: 1, accounts: {
[apiUrl]: { accountId, issuedAt } } }`, identifiers only, NEVER a
credential, unknown keys preserved; spec
2026-09-02-home-config-trial-identity-design.md). The nola row's HINT follows
`FlowInput.keyPath` (`nolaHint`): the free runs on a fresh machine, "Trial
key already issued. Get another? Enter to sign in." once the trial is used,
"a key on your Nola account (signed in as …)" when signed in. On the `sign-in` path Enter on the
Nola row runs the browser sign-in AT THE SELECT (`FlowInput.signIn`, a
`runFlow`-built wrapper over `auth.signIn`; `resolveProvider` loops back to
the menu when it fails, after a "Could not sign in to Nola: …" note) — the
browser must never open after later questions; the KEY is still minted after
every question by `acquireKey`, which then finds the stored session, so a
cancelled flow consumes nothing (`SIGN_IN_QUESTION` survives only for `nola
key`'s confirm). Then
`scaffold({ provider: "nola" })` (skips `nola.replay.jsonl`, renders
`__START_NOTE__` / `__PROVIDER_NOTE__` in the starter README) and
`applyTrial` (`src/trial.ts`: `.env` append-never-overwrite via
`writeEnvKey`, the `.gitignore` guard `.env` + `.env.*` via
`ensureEnvIgnored`, and `templates/_providers/nola.config.ts` — the
`_providers` dir is not in the template registry). Any API failure notes the
reason + `npx nola-lang key` and scaffolds the plain (`none`) template with
exit 0. The add path applies the key to an existing config only by note. `nola key [--print]` (`nola-lang/src/key.ts`,
spec 2026-09-04-nola-key-command-design.md) runs the same `acquireKey` and
writes `.env` through `writeEnvKey` (`{ replace }` rewrites an existing line;
it touches NOTHING else): key FIRST, then the clack confirms "Add it to
.env?" (Yes) and, on an existing key, "replace it?" (No); `--print` puts ONLY
the key on stdout (sign-in instructions to stderr). `nola login` /
`nola logout` (`nola-lang/src/login.ts`) run `signIn` / `signOut`
(`/oauth/revoke` best-effort); login also claims the cwd project's trial key
into the account (`claimProjectKey`: `POST /v1/billing/session` with the key
→ `POST /v1/console/sessions/:id/claim` with the access token, the id read
from the session URL's `?session=`). `nola account`
(`nola-lang/src/account.ts`, was `nola billing` until 2026-09-05 — the
command shows an account, and the platform's `/billing` route is the
accountless session card) signs in when needed (non-interactive: exit 1
naming `nola login`), claims the cwd project's key, prints `GET
/v1/console/me` (`Nola account: <email> — N / 25 free runs used`, `Balance
$X.XX`), and opens `<consoleUrl>/account` (`consoleUrl` from capabilities,
fallback `CONSOLE_URL`) — the browser holds its own Auth0 session, no
CLI-minted billing session, no `--key`; the device token (2026-09-03) is
GONE on both sides. its `WIRE_MIRROR` constant pins create-nola-lang's structural copies of the
core wire types at `tsc -b` time — keep both sides identical. The session
`url` is OPAQUE: since the platform's console split (2026-08-25) it points at
`https://platform.nola.sh/billing?session=…`, a different origin from the
API — never derive it from `baseUrl`/`NOLA_API_URL`, and never assert its
shape in tests. Since 2026-09-04 the CLI's account is the Auth0
user (console API ON in production is a platform prerequisite — until then
`GET /v1/capabilities` carries no `auth` and the CLI says sign-in is not
available yet); web-address copy offers `npx nola-lang key` or
bring-your-own-provider (https://nola.sh/docs/reference/providers-api/). Web-address copy: `CONSOLE_URL` stays exported but unused by
any message; every refusal, the missing-key error and the trial notes point
at `PROVIDER_DOCS_URL` (account.ts), https://nola.sh/docs/reference/providers-api/;
there is no free-credits promise anywhere — the offer is "25 free runs".
Example templates are served from `examples/` on disk inside
this checkout (root manifest name `nola-monorepo`) and from GitHub in
production (Trees API at tag `v<version>`, `main` fallback — release tagging
matters; all files buffer before any write). DEV-MODE RELINKING (`src/checkout.ts`): the
scaffold always writes the published range (`^<lockstep>`, what users get),
so a checkout-linked or locally installed CLI's install fetches the last npm
release — with `NOLA_LINK_CHECKOUT=<nola-private root>` set, a successful
interactive install is followed by replacing `node_modules/@nola-lang/runtime`,
`@nola-lang/providers` and `nola-lang` with junctions into that checkout's
`packages/*` (`linkCheckoutPackages`; internal deps resolve through the
junction's real path into the checkout's hoisted node_modules) plus an outro
note. An env var, not detection, so a CLI installed OUTSIDE the monorepo can
be pointed at it while testing; unset = never. Declining the install, the add
path and non-interactive runs never install, so they never relink (the e2e's
`linkDeps` covers that case by hand); a
later `npm install` in the scaffold restores the registry copies. The curated examples are
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
  `parseFunctionParams`, `parseMethod`, `parseFunctionBodyAndFinish`, `isClassMethod`, `parseMember` (tolerant-only: a dangling `x.` recovers verbatim so TypeScript completes and diagnoses it itself).
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
  the underivable members — the checker walk's `lossy` flag, a named type that
  prunes to nothing fails its referencing member; a type that prunes to nothing
  falls back to omit), `"omit"` (the old silent drop, explicit opt-in). Since emit
  15 the policy rides the derivation REQUEST (`meta.derivations[].policy`) and is
  applied by `finalizeDerivations` / the editor's lazy pass, not by the lowerer.
  The policy governs ONLY that seam: plain params derive under "omit" in every
  mode (an underivable plain type yields no schema, silently), extract sites keep
  NOLA2002, exported types keep `UnsupportedType`. Plumbing: `resolveCompilerConfig` (runtime)
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
  `__nola.intents.ExtractIntent(...)`, `__nola.intents.FunctionCallIntent(...)`
  (no mapping layer; the `Intent` key is kept for emit-surface stability); non-class
  helpers stay lower-case — `__nola.ask`, `__nola.fmt`, `__nola.useRuntime` at the
  top, context accessors under `__nola.context` (since emit 8: `__nola.context.file`,
  was top-level `fileContext`). The classes live in
  `packages/runtime/src/intents/`, ONE SUBFOLDER PER INTENT, each holding the
  intent next to the context node that backs it: `extract/` (`ExtractIntent`
  + `ExtractContext`), `function-call/` (`FunctionCallIntent` +
  `FunctionCallContext` — "call", not "calling", since emit 12),
  `invocation/` (`InvocationIntent` + `InvocationContext`, the infer
  function's frame node — was `FunctionInferContext` under `infer-context/`);
  the folder root keeps the intent-less bases (`intent.ts`,
  `executable-intent.ts`) and the single barrel `index.ts`.
  `packages/runtime/src/infer-context/` holds ONLY nodes with no intent
  behind them — `InferContext` (base), `SystemInferContext`,
  `FileInferContext`. Rule of thumb: a node that composes an `intent(...)`
  or opens a frame lives with its intent; a pure lineage node lives in
  `infer-context/`.
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
  sha256 over the canonicalized `{ prompt, params }` (plus `profile` ONLY
  when a managed-mode profile is present — profile-free asks keep their v5
  hashes, so ledgers never re-keyed) where `prompt` is the
  CLASSIC RENDERING of the ask as first composed — a model payload is
  rendered through `renderClassic` with its `correction` stripped, a
  `ClassicPrompt` payload keeps only its first user turn — so a model-dialect
  provider (nola) and a chat provider key the same ask identically and one
  ledger serves both (the fingerprint identifies the ask as first composed,
  never the retry). `FINGERPRINT_VERSION` is a compatibility surface — bump
  it when the serialization changes shape (it is 5; the deliberate cost of
  hashing the rendering is that a Nola release rephrasing the classic prompt
  re-keys every ledger — accepted so the model never has to leave the
  runtime through a chat provider). The fingerprint
  CACHE is deliberately unwired right now (`cache.test.ts` is skipped; see
  TODO(cache) in `inference.ts`) — the `cache: { store? }` config section
  validates but is not served. `record(inner, path)` / `replay(path)` stay
  live: fingerprinted JSONL ledgers keyed by request fingerprint and storing
  the payload as sent (the rendering for a chat provider, the model for
  nola) — `record` inherits the inner provider's dialect brand; replay is
  dialect-agnostic and strict (unknown
  fingerprint = NOLA3008 definitive error, never a silent live call); entries
  with the SAME key — an ask's first attempt and its correction turn hash
  identically, since the fingerprint strips the correction — replay in
  recorded (FIFO) order, so a correction pair replays as a correction instead
  of collapsing to the last line; ledger content is redacted but fingerprints
  are not (`redactSecrets` eats 32+-char hex, so never redact a whole ledger
  line). Any change to the rendered prompt or to params re-keys every
  ledger/cache by content. Codes: NOLA3006 CacheStoreInvalid, NOLA3007
  ReplayLedgerInvalid, NOLA3008 ReplayFingerprintMismatch.
- **The ask boundary is `Inference`** (`packages/runtime/src/ask/inference.ts`) — a
  per-ask, single-shot strategy object. The base owns model composition
  (`buildModel` → `buildInferenceModel`, the `ModelBuilder`), span lifecycle,
  hook events, the request fingerprint, the one-correction retry loop, the
  contract check, and receipt emission; subclasses own the wire dialect
  through three seams: `parse` / `validateResult` / `correctionRequest`.
  There is NO strategy-selection layer — each intent constructs its Inference
  directly (`new JsonInference(task)` in ExtractIntent/FunctionCallIntent).
  `InferenceTask` = `{frame, site, options, context}` — `context` is the
  ask-site node composed before the frame chain; there is no separate prompt
  field, only the model. What crosses to `LanguageModel.complete` is
  `ProviderRequest = { payload, params?, signal?, trace? }` where `payload`
  is `ClassicPrompt | InferenceModel`, picked by the provider's DIALECT:
  `isModelProvider(provider)` (core `provider-dialect.ts` — the
  `MODEL_PROVIDER` global-symbol brand that `nola.infer()` sets and
  `withRetry`/`record` copy forward; `fallback`/`roundRobin` demand one
  shared dialect and throw NolaConfigError otherwise) gets the canonical
  model, everyone else gets `renderClassic(model)`. There is deliberately NO
  public `dialect` option: a custom provider always receives the rendering,
  `mockProvider`'s callback is typed on it (`MockRequest`), and
  `classicPayload(req)` (providers) is the typed accessor that fails
  definitively on a model. The model leaves the runtime only through
  `nola.infer()` — friction against reuse of the structured ask, not a security
  boundary (the runtime is open source). `onProviderRequest` carries the
  `payload` as sent. `trace` carries `{askId,
  invocationId, spanPath}` for providers (like `nola`) that want it. The
  receipt's `originalPrompt`/`effectivePrompt` pair still holds the composed
  conversation (role-labeled transcript, via `describeModel`/`renderClassic`):
  `originalPrompt` as first composed, `effectivePrompt` as last sent — they
  diverge exactly when a correction retry ran (and under future middleware
  rewrites).
- **Prompt composition is the `ModelBuilder`.** One composer
  (`ask/model-builder.ts`, implementing the node-facing `InferenceComposer`
  seam in `ask/composer.ts`) builds the `InferenceModel` in two passes: pass 1
  walks the ask-site node, then the frame chain inner→outer (`context.compose`,
  then `frame.compose` describing the asking frame and recursing to its
  caller via `composer.outer()`); `build()` reverses into the outer→inner
  scope chain (innermost is `model.scope`, callers via `parent`), collecting
  scope/input/output into pure JSON — no wording yet. Pass 2 renders any
  prompt templates outer→inner from a scope built OVER
  the finished model — `.default` is that node's classic block, `.next` /
  `.format` the classic remainder — into per-node `text` overrides
  (`scope.text`, `model.input.text`); the built-in wording never reaches the
  model at all unless a template reads `.default`/`.next`. That wording lives
  in `renderClassic` (`@nola-lang/core/render-classic.ts`), a pure function
  `InferenceModel → ClassicPrompt` that the RUNTIME calls once per attempt
  for every provider without the model-dialect brand (providers receive the
  result as `req.payload`; none renders itself) and that reproduces the old
  composed text byte-identically. `describeModel` (`ask/inference.ts`)
  renders a model through `renderClassic` into the role-labeled transcript
  the receipt's `originalPrompt`/`effectivePrompt` and `NolaResolutionError`
  still carry; the ask fingerprint is taken over that same rendering as
  first composed — see Fingerprints below. History does NOT reach the model
  yet (TODO(history) markers in tests).
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
- **Tracers are telemetry entries** (config v2 spec 2026-09-08 + same-day
  amendment). `telemetry` is `{ level?: NolaLogLevel } | NolaTelemetry |
  ReadonlyArray<NolaTelemetry>`: `{ level }` is the terminal ALONE
  (`terminalTrace({ level })`), one observer or an array REPLACES it and
  implies nothing (list `terminalTrace()` to keep the terminal); absent =
  `{}` = `terminalTrace()` at `debug` (every event); `[]` silent; the global
  `console` is NOT an entry; `hooks` is a NOLA3003 naming `telemetry`;
  `NolaTelemetry` is the observer interface, was `NolaHook`; the resolved
  shape is always the observer array. `terminalTrace({ level?, color? })`
  (`src/terminal-trace.ts`, name `nola:terminal`) prints core's
  `formatIngestLine` (`packages/core/src/ingest-line.ts`, shared with the
  `nola console` process) over the same envelopes the tracer posts
  (`src/ingest-envelope.ts` — `envelopeObserver`), to STDERR (stdout stays
  the program's — the e2e suites parse it as JSON), in colour on a TTY
  (core's `ansiPalette`; `NO_COLOR` or `color: false` gives `plainPalette`,
  text identical), so the app terminal and the console process print
  identical lines; the level gates by kind (error: failed asks; warn: +
  validation/retry; info: + ask start/end and invocation start/end; debug: +
  provider request/reply). `nola.tracer(url |
  { baseUrl?, apiKey?, apiKeyEnv?, fetch? })` (`src/tracer.ts`, name
  `nola:tracer`) turns every event into one kind-discriminated
  `NolaIngestEnvelope` (seq-ordered under one runId, project read from the
  latched config at send time, sender-side redaction preserving
  `fingerprint`/`def`) and fire-and-forget POSTs it to `/v1/ingest` (1.5 s
  timeout, warn once when unreachable, once-per-process notice off-loopback;
  keyless on loopback). A listed tracer is never gated — `nola.infer()` does
  NOT imply one (the capability-probed platform tracer is gone).
  `NOLA_TRACING_URL` = "append `nola.tracer(url)`": it yields, with one
  notice, to a listed `nola:tracer`; a resolved config (stamped `RESOLVED`)
  is left alone. The runtime's observer list is the resolved `telemetry` and
  nothing else — there is no always-first built-in logger.
- **The platform model** posts a `NolaInferRequest` — `{ protocol: 1,
  version, askId, invocationId, spanPath, intent: InferenceModel, model?,
  profile?, params }` — to `/v1/infer` and reads a `NolaInferResponse` (`{ text }`).
  `model` is OPTIONAL: `nola.infer()` sends none and the server chooses (trial keys
  are restricted server-side); `nola.infer("provider/model")` sends the
  selector. Base URL: `baseUrl` → `NOLA_API_URL` env →
  `https://api.nola.sh`, read at request time. Non-2xx bodies are the
  platform's `NolaErrorResponse` (`{ error: { code, message, details? } }`):
  the message is surfaced VERBATIM on `NolaProviderError` with `code` /
  `details` (402 `quota_exceeded` carries `{ runsUsed, runsLimit }`), and
  `definitive` is every 4xx except 408/429 — a non-JSON body keeps the generic
  `Nola API request failed: …` form. The `x-nola-runs-used` /
  `x-nola-runs-limit` reply headers drive a `console.warn` usage line once
  per count while ≤ `LOW_RUNS_NOTICE` (5) runs remain. The wire types
  (`NolaInferRequest`, `NolaErrorResponse`, `NolaTrialRequest/Response`,
  `NolaAccountResponse`, `NolaBillingSessionResponse`, `NOLA_USAGE_HEADERS`,
  `NOLA_API_URL`, `NOLA_PROTOCOL`) live in `@nola-lang/core`
  (`nola-protocol.ts`) because the platform repo imports them verbatim.
  `version` is `packages/runtime/src/version.ts` (the client lives in the
  runtime — `src/platform-model.ts`), rewritten by `release.mjs`.
- **Intent inits carry no `file`.** Since emit 3 the display path is emitted once
  per file, in `__nola_file_ctx`. The ask boundary derives it at ask time from
  the frame (`frame.sourceFile()`: the static `InferContext` chain first — the
  `FileInferContext` node answers — then the caller frame chain, for scope-less
  extract/call asks); a lineage with no file root anywhere reports `<unknown>`. Since emit 4
  the lowered EOF insert opens with
  `__nola.useRuntime(<NOLA_EMIT>)` (was `__nola.assertEmit(3)` through emit 3; the
  contract is 16 today — emit 16 is JSDoc constraints (spec 2026-09-15): a
  carrier gains `.constrain({ … })`, one `constrained` node kind carrying the
  JSON Schema validation vocabulary (`packages/runtime/src/types/constraints.ts`
  — the keys ARE the keywords; strings minLength/maxLength/pattern/format,
  numbers minimum/maximum/exclusiveMinimum/exclusiveMaximum/multipleOf/integer,
  arrays minItems/maxItems/uniqueItems; nine validated formats), emitted by
  the walk from `@format` / `@minimum` / … JSDoc tags on a property or a type
  alias (`packages/derive/src/constraints.ts`: kind decided on the non-null
  part — string incl. literal unions/enums, number incl. literals, array incl.
  tuples; `.constrain` goes INSIDE `optional`, OUTSIDE `nullable`; an alias's
  tags land in its accessor body, and a property typed by a bare alias of a
  primitive now REFS the alias by written name so the tags apply). Schema:
  keywords merge into the inner schema (nullable's non-null branch, `integer`
  → `type: "integer"`, beside a cyclic `$ref`); validation runs the keywords
  after the inner check on the value it produced, one issue each, in the
  all-errors pass. A wrong-kind / malformed / repeated / unknown-format tag is
  NOLA2012 (InvalidConstraint), thrown under prune too, and routed by
  `finalizeDerivations` like NOLA2007 — a diagnostic at EVERY site kind, never
  UnsupportedType, never a policy. Dialects: openapi-3.0 spells exclusive
  bounds as `minimum` + `exclusiveMinimum: true`; draft-07/openapi wrap a
  `$ref` with siblings in `allOf`. Emit 15 is checker-backed derivation: every derivation
  site calls an appendix accessor (`__nola_type_$N()` for inline extractor
  types and parameter annotations, `__nola_type_<Name>()` for named/exported
  types) and `__nola.types` gained literal / union / nullable / tuple / record
  (+ object's `{ additional }`); emit 14 made every exported type a value
  (`TypeValueOf<typeof __nola_type_X, X>` cast) and retired companions for
  `./x.tsi` view imports; emit 13 stamps `def` on the extract/call inits: the
  compiler-hashed ask source identity (`defHash` in lower/templates.ts —
  sha256 over displayFile + raw instruction/callee text + type source text,
  line/col excluded; AskDefinition spec 2026-09-01; NEVER part of the ask
  fingerprint); emit 12 renamed the call-intent factory key to
  `__nola.intents.FunctionCallIntent` (was `FunctionCallingIntent`) with the
  class; since emit 11 the func/extract/call inits accept an
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
  `FINGERPRINT_VERSION` is 5). Everything the emitted text references must be exported from
  `@nola-lang/runtime` — `__nola` and, since emit 5, the
  `InferType` type (since emit 6 also `UnsupportedType`, since emit 15 also
  `TypeValueOf`). Since emit 9 the
  built-in `Date` derives (only when unshadowed by a local declaration or
  import) to `__nola.types.date()`: wire schema `{ type: "string", format:
  "date-time" }`. Since emit 15 validation is CARRIER-DRIVEN and single-pass
  (`validateCarrier`, `packages/runtime/src/types/validate-carrier.ts`): one
  walk checks every node, collects EVERY issue (the correction turn lists them
  all) and builds the revived value (ISO string → `Date`) as it goes — with
  unions the matching branch decides revival, so check and revive cannot be
  two passes. It is an INTERPRETER tuned to allocate nothing per node on the
  success path (2026-09-15): the path is a linked list materialized only
  into an issue, value-independent facts (a union's discriminator, an
  object's required keys, tuple bounds, whether a subtree can revive) are
  memoized per immutable node in WeakMaps, dates parse once, and a subtree
  with nothing to revive is returned as the INPUT REFERENCE (only revivable
  paths are copied). `validate-carrier-perf.test.ts` guards it with a ratio
  against a JSON round-trip of the same value (interleaved, best-of-N), not
  an absolute number; the old shape sat at ~2.3×, this one under 1×.
  Compiled validators (closure tree or `new Function`) are the next tier if
  we ever compete on validator benchmarks — not needed for the ask path.
  The ask path reaches it through `InferContext.outputType()`
  (extract: the site's carrier; call: one object carrier with a described
  property per slot); the JSON-Schema validator in `ask/validate.ts` survives
  only as the raw-`JsonSchema` oracle. `InferType` (the public four-member
  interface: `toJsonSchema`/`validate`/`parse`/`~standard`) is what every
  type value is typed as; the class behind it is `TypeCarrier` (internal).
  `~standard` implements BOTH Standard Schema v1 (`validate`) and Standard
  JSON Schema (`jsonSchema.input/output({ target })`, spec types vendored in
  `types/standard-schema.ts`): `toJsonSchema()` IS the draft-2020-12
  document, `draft-07` and `openapi-3.0` are pure rewrites of it
  (`types/json-schema-dialects.ts` — `$defs`→`definitions`, tuples to
  `items[]`+`additionalItems` / to an element-union array, `const`→`enum`,
  `type:"null"`→`nullable`), memoized per target, input = output (JSON
  Schema cannot say "a `Date` instance"), any other target is NOLA3017. A
  new node kind is added ONCE in `expand` and reaches every target; the
  ambient stub mirrors the `jsonSchema` member.
- **Checker-backed derivation (emit 15, spec 2026-09-14).** The lowerer never
  derives a schema. PHASE 1 (`compileNola`, pure, no TypeScript): every
  derivation site — exported type, extractor `<T>`, parameter annotation —
  calls an appendix accessor with the INERT body `(undefined as never)`, and
  `meta.derivations` records each request (`accessor`, `kind`
  exported|extract|context, `source` range, `lowered` range = where the SAME
  type node sits in the lowered text, `policy`); `meta.appendixStart` marks
  the accessor block. PHASE 2 (`finalizeDerivations(result, answers, file)`):
  the appendix tail is rewritten from the answers — combinator bodies,
  `UnsupportedType<reason>` accessors, undefined-returning context accessors
  (policy), transitively reached named accessors once each, and the `./x.tsi`
  value imports the walk reached; NOLA2002/NOLA2008/NOLA2007 come from
  `ok:false` answers at the request's source range. The body is NEVER touched
  (the appendix is unmapped, so spans/map/anchors hold). `@nola-lang/derive`
  owns the walk (`deriveType` over the TypeScript checker: resolved
  properties, so `extends`/intersections/`Partial`/`Pick`/`Omit`/generics at
  the instantiation site flatten; unions → `union`/`nullable`/`enum`; tuples,
  records, literals; the name as WRITTEN at a site wins for refs; lib nominal
  types other than `Date` are unsupported; package/lib types derive
  structurally into hashed local accessors `__nola_type_x_<sha8>`; project
  files become view imports + `<moduleId>#Name` refs; a named type's failure
  propagates to its referencing site) and the `DerivationService` (ONE
  `ts.LanguageService` per process rooted at the nearest tsconfig — strict
  NodeNext defaults without one — serving `.tsi` files and views of plain
  modules as lowered virtuals `x.tsi.ts`; `derive(file, phase1)`,
  `deriveView(src)`, `invalidate(file)`; answers carry `deps`, the declaration
  files read). Consumers: the loader's hooks worker (one service per project
  root, `transformNola({ derive })`), `nola-lang`'s `ProjectDeriver`
  (build/check/declarations; tshost gets the FINALIZED view through its
  `deriveView` hook so `nola check` type-checks real bodies and the
  UnsupportedType elaboration), unplugin (service on the project context,
  `deps` → `addWatchFile`, `watchChange` → `invalidate`), the Turbopack loader
  (derive + TypeScript EXTERNAL to its bundle; `inlineViews` replaces view
  imports on the finalized appendix). The editor serves PHASE-1 output
  (`NolaVirtualCode.derivations`) and runs `derivationDiagnostics` lazily on
  each diagnostics pass against the live program — the LSP's nola service
  injects `typescript/languageService`, the tsserver plugin decorates the
  INNER `getSemanticDiagnostics` before Volar proxies it — shifting `lowered`
  offsets by Volar's source-shaped leading whitespace; an underivable
  exported type is typed `InferType` in the editor (only `nola check` shows
  the elaboration). The corpus test `packages/derive/test/corpus.test.ts`
  replays `test/derivation-corpus/type-exprs.json` (recorded from the last
  syntactic walker): the multiset of combinator expressions per file must
  match byte for byte — the fingerprint invariant. `derive` pins
  `typescript >=5.6.0 <7` (TypeScript 7 has no JavaScript API). WHICH
  TypeScript the walk runs on is `packages/derive/src/ts.ts`: derive never
  imports `typescript` statically — source files do `import type ts` for
  types and `import { TS } from "./ts.js"` for values, a Proxy resolved on
  first use — and `useTypeScript(module)` (exported) injects the host's. The
  editors MUST inject: the language server passes the tsdk the client named
  (`server.ts`), the tsserver plugin the module tsserver hands its factory
  (`plugin.ts`) — their bundles keep `typescript` external and the VSIX
  stages NO copy beside them, so a static import crashed the server at load
  ("Cannot find module 'typescript'", 2026-09-15) and silently dropped the
  plugin; walking a program with a different TypeScript than built it is
  wrong regardless. The loader, CLI and bundler plugins never inject and get
  derive's own dependency lazily. `test/e2e/editor-bundles-standalone.test.ts`
  guards this by staging both bundles OUTSIDE the repo with a copied
  TypeScript as tsdk/tsserver — in-repo runs cannot catch it (the bundles
  sit beside a resolvable `typescript`, and tsserver probes three levels
  above its own executable, which in the repo is `node_modules` with the
  workspace symlink to the in-repo plugin). The same suite pins that neither
  editor bundle inlines the runtime: the editors take `findProjectRoot` from
  `@nola-lang/node-loader/project-root` (a runtime-free module — never add a
  runtime import there), because the package index evaluates
  `register.ts`/`config.ts` and would drag the whole runtime, slot claim
  included, into an editor process. The three CJS bundle scripts
  (language-server, typescript-plugin, next) FAIL on any esbuild warning and
  inject `scripts/esbuild/import-meta-url.js` so an inlined ESM
  `import.meta.url` (derive's fallback, the loader's `module.register`
  parentURL) is the bundle's own file URL rather than esbuild's empty `{}`;
  the tsserver entry is `tsserver-entry.cts` (`export =`) because a
  `module.exports` in an ESM-typed `.ts` is itself a bundler warning.
- **Cross-file types: the `*.tsi` view rule (emit 14; companions and the
  `*.nola.*` namespace are RETIRED, NOLA2006 with them).** A type reached in
  another project file lowers to `__nola.types.ref("<moduleId>#<Name>", () =>
  __nola_type_<local>)` — a closure over the imported VALUE, read only at
  schema time (cycle-safe) — plus the appendix import `import { <Name> as
  __nola_type_<local> } from "./x.tsi"`; `meta.views` lists the `.tsi`
  specifiers. `./x.tsi` means the on-disk Nola file when it exists, otherwise
  the VIEW of `x.ts` (then `x.d.ts`): `compileView` (phase 1, like
  `compileNola`) re-exports the module (`export * from "./x.js"`), redeclares
  every exported alias/interface (`export type X = import("./x.js").X`) and
  exports each as a value; the same rule serves user-authored `./x.tsi`
  imports from plain `.ts`. Hosts: the loader's `resolve` (`?nola-view` URL
  marker, `deriveView`), unplugin (`\0nola-view:<abs>`), tshost (virtual
  `x.tsi.ts`), the editor's `decorateHostWithViews` (synthetic script from
  the live snapshot) + `decorateServerHostForViews`; `nola build` writes
  `<base>.tsi.js` + `<base>.tsi.d.ts` for every view reached — INCLUDING
  views reached only from the tsconfig's plain `.ts` roots in a project with
  no `.tsi` at all (the types-only use, `docs-site/guides/types-without-a-model.mdx`;
  `emitDeclarationTexts` must not short-circuit on zero lowered files);
  Turbopack inlines. Neither file on disk is NOLA2007 (the walk keeps that identity for
  a dangling relative type import); a same-basename `.ts` + `.tsi` pair warns.
  Refs are `<moduleId>#`-qualified (posix project-relative, extensionless) so
  same-named types from different files never collide in one `$defs`; bare
  names stay for file-locals. Type imports should use the NodeNext `./x.js`
  convention (a type-only import never resolves at run time).
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
  the tsc-clean test helper, the headless editor harness, AND the editor host
  decoration `decorateHostWithRuntimeStub` (typescript-plugin, applied by the
  language server): when `@nola-lang/runtime` does not resolve from a file —
  a scaffold opened before `npm install`, a bare `.tsi` — the lowered appendix
  import is served the stub under `/__nola_stubs__/runtime.d.ts` (tshost's
  path) as an external-library file; the installed package wins whenever it
  resolves. Without it the appendix TS2307 stays invisible (unmapped) and only
  its derivative surfaces — "Parameter '__frame' implicitly has an 'any' type"
  on the infer header (`editor-lsp-no-install.test.ts`). Volar's server caches
  a failed lookup until a watched-file event for that path and VS Code never
  reports `node_modules` changes (files.watcherExclude), so after the install
  the stub keeps serving until a window reload — benign, because the stub and
  `__nola.ts` are held in lockstep. Keep it in lockstep with `__nola.ts` and
  `emit-surface.test.ts` when the emit surface changes.
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
  `__nola.fmt` template literal. Runtime: the
  `ModelBuilder`'s pass 2 (see Prompt composition above) renders each
  template into an override on the already-built model — `scope.text` for a
  function template, `model.input.text` for an extractor — building
  `FunctionPromptScope` / `ExtractPromptScope` over the finished node and
  calling `renderTemplate` (`ask/prompt-render.ts`). For a function template,
  READING `.next` renders the remainder (callee scopes + TASK) into the
  template's own output and sets `scope.coversRemainder`, which then stops
  `renderClassicText` from walking further INWARD — it will not append the
  callee scopes/TASK again (`@nola-lang/core/render-classic.ts`); leaving
  `.next` unread leaves `coversRemainder` unset, so the renderer continues
  rendering the remainder after the scope's own text, same as today. For an
  extractor template, an unread `.format` is appended after the template's
  own text instead (safe by default), so the response-discipline lines are
  never dropped by omission. `.default` is the built-in block;
  empty/throwing template = NOLA3014. `instruction` stays a string everywhere
  (history, describe, errors). Codes: NOLA1015 (tolerant `${.` placeholder —
  lowers to `__nola_s.` so TS still completes), NOLA2009 (scope access
  outside a Nola literal), NOLA2010 (Nola construct in a copied hole). Emit
  11.
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
  SELF-CONTAINED, version-stamped copies into user projects. Three targets
  since 2026-09-15 (`--agents claude,universal,agents-md`): `claude` copies
  the whole directory to `.claude/skills/nola/` (Claude Code reads only its
  own dir), `universal` copies it to `.agents/skills/nola/` (the open Agent
  Skills location Cursor, Copilot, Codex, Gemini CLI read natively — the
  skills CLI's own word for it) — copies, not links, because a committed
  symlink dies on Windows checkouts and a junction needs an absolute
  target; `agents-md` embeds SKILL.md's body inline. Both copies are
  preselected. The
  `.cursor/rules/*.mdc` / `.github/instructions/*.md` adapters are RETIRED
  (a stamped leftover is "superseded" under `universal`, deleted with
  `--force`); the
  pointer-into-node_modules form was reversed 2026-08-20. `npx skills add
  nola-lang/nola` (vercel-labs/skills) and `npx skills experimental_sync`
  (from `node_modules/create-nola-lang/skills`) produce the same layout
  unstamped — we document them, never depend on them. It lives in
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
  `withRetry`/`withModel`/`withParams` only; not thenable, since bare await
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
  resolved config, model resolution, hook dispatch (+ warn-once ledger), and the
  `fileContext` memo; `nolaRuntime.reset()` discards the instance wholesale. Config **latches on the
  first ask**: `nolaRuntime.configure()` may be called freely before it, throws `NolaConfigError`
  after it (a failed unconfigured ask does not latch). Routing precedence, highest first:
  `forceModel` → a middleware `ctx.model` reassignment → the ask-site pin
  (`ask with <name>` / `.withModel()`) → `model.default`. The config key
  `model` takes a bare model (normalized to `{ default }`) or a named map;
  `ResolvedNolaConfig.model` is always the map.
  `NolaRuntime.resolveModelProfile(ref?)` owns that ladder (`resolveModel`
  delegates) — never read the model map directly. Platform profiles: with
  `isPlatformModel(model.default)` (core's `PLATFORM_MODEL` brand + `infer`),
  an ask-site name that names no map key is NOT NOLA3004 — the ask resolves
  to the serving model (default, or forceModel) and the name rides
  `ProviderRequest.profile` → `NolaInferRequest.profile` (additive optional;
  the platform's routing resolves it to a model and params), joins the
  fingerprint (present-only), and lands on `ProviderRequestEvent.profile` +
  `AskReceipt.profile`. The profile is computed from (name, map) alone —
  force or not — so record/replay fingerprints agree between live and forced
  runs (the forced-replay shape is `{ default: nola.infer(), replayed:
  replay() }` + `forceModel`). `plugins` is the only remaining reserved
  config key.
- **Telemetry observes; middleware is currently UNWIRED.** Events are emitted from fixed
  points in `Inference` so observers can never miss an ask: `askEnd` always fires with a
  receipt. Observers run in `telemetry` list order; a tracer is an observer. A throwing observer is swallowed and warned about once per observer+method. The
  middleware pipeline (`ask/pipeline.ts`, the `middleware` config section, the
  `ask-middleware.test.ts` suite — skipped) is infrastructure kept for
  re-introduction, but the ask path calls its terminal directly today; when it
  returns, a throwing middleware fails the ask and `ctx.model` reassignment
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
  in the same commit, exactly as it updates the agent skill. Version numbers
  never appear in docs prose; the only literals allowed are Nola-package
  dependency entries in `package.json` samples, and `scripts/release.mjs`
  rewrites those (in `docs-site/` AND the skill) to `^<version>` on every bump —
  `test/docs-site.test.ts` fails on any entry that disagrees with the lockstep
  version.

## TDD workflow

Every change follows the plan's rhythm: write the failing test, see it fail,
implement the minimum, see it pass, then `npx tsc -b`, `biome check --write`, and
commit. Commit after each green step; keep commits scoped to one package/feature.
