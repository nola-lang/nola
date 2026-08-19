# Nola

**Nola** is an AI-notation **TypeScript superset language** (`.tsi`). It adds new
syntax that lowers to plain TypeScript before any downstream tool sees it — the JSX
model — where a configured LLM acts as part of the language runtime, extracting data
from context at run time.

```tsi
// analyze.tsi
export infer function analyzeUserRequest(userId: string) {
  const ticketId = ask ..`ticket id mentioned in the message`<string>;
  const isFraud = ask ..`does the message look fraudulent`<boolean>;
  return { userId, ticketId, isFraud };
}
```

```ts
// main.ts — plain TS imports the .tsi directly
import { analyzeUserRequest } from "./analyze.tsi";

const result = await analyzeUserRequest("user-1").withContext({
  message: "Ticket TCK-4711: customer reports suspicious activity.",
});
// → { userId: "user-1", ticketId: "TCK-4711", isFraud: true }
```

## The core constructs

| Construct | Syntax | Meaning |
|---|---|---|
| **Extractor** | `` ..`prompt` `` with optional `<T>` | An `Intent<T>` — a request to pull data from context. Legal anywhere. Supports `${}` interpolation. |
| **`ask` operator** | `ask <intent>` | Resolves an intent via the LLM (like `await` for a `Promise`). Only inside nola function bodies. `ask` is a reserved word in `.tsi`. |
| **Provider routing** | `ask with <name> <intent>` | Resolves the ask through a named provider from `nola.config.ts`. |
| **Nola function** | `infer function name(…) { … }` | The mounting point: importable from plain TS/JS; returns a lazy, thenable `Intent<T>`. |
| **Context** | `.withContext({…})` on the returned intent | Seeds the invocation; accumulates across `ask`s within one call. |
| **Call intent** | `` fn``(…) `` | Lets the LLM fill a function's arguments, then calls it. |

Typed extractors (`` ..`p`<T> ``) derive a JSON Schema at compile time from `string`,
`number`, `boolean`, arrays, inline object literals, and same-file type/interface
aliases; JSDoc comments on members become schema descriptions.

The language reference that ships with the package — the agent skill in
[`packages/nola-lang/skills/nola/`](packages/nola-lang/skills/nola/) (`SKILL.md` +
references) — is the up-to-date description of the surface: syntax, lowering,
configuration, and the runtime contract.

## How it works

```
source.tsi
  → @nola-lang/parser  (vendored @babel/parser + `nola` plugin) → Nola AST (lossless locations)
  → @nola-lang/compiler (magic-string span replacement)         → plain TS + source map
      ├─ nola build  → esbuild type-strip → .js + .map, + adjacent .d.tsi.ts
      ├─ nola run    → same transform in-memory via a module.register loader
      └─ nola check  → tsc API over lowered TS → diagnostics remapped to .tsi
```

Nola is **not** valid TypeScript, so `tsserver`/`tsc` can't parse it directly. Nola
owns the parse (a vendored Babel 8 fork with a `nola` internal plugin) and only ever
hands *lowered plain TS* to `tsc` — no tsc fork, no tsc plugin. This is the same
approach Vue and Svelte take.

## Packages

| Package | Role |
|---|---|
| `nola-lang` | The dev tool users install (devDependency): `nola init` / `build` / `run` / `check` bin + `nola-lang/register` loader hook |
| `create-nola-lang` | `npm create nola-lang` — interactive scaffolding (templates + the prompt flow live here; `nola init` reuses both) |
| `create-nola` | `npm create nola` — short alias; its bin forwards to `create-nola-lang` |
| `@nola-lang/core` | `Intent<T>`, `JsonSchema`, provider/config/hook/middleware types (dependency-free) |
| `@nola-lang/ast` | Nola AST node types, visitors, diagnostic codes |
| `@nola-lang/parser` | `.tsi` source → Nola AST with structured diagnostics |
| `@nola-lang/compiler` | AST → plain TS + source map; JSON-Schema derivation |
| `@nola-lang/runtime` | The app dependency: intent resolution, validator, `defineConfig`, hooks/middleware, logger |
| `@nola-lang/providers` | Everything provider-shaped: `openai`, `mockProvider`, resilience combinators, record/replay |
| `@nola-lang/node-loader` | `module.register` hooks + `nola.config.ts` loading |
| `@nola-lang/babel-parser` | Vendored `@babel/parser` (v8.0.0-rc.6) with the `nola` plugin — private |
| `nola-vscode` | Stretch: TextMate grammar for `.tsi` highlighting |

## Getting started

Requires **Node ≥ 22**. Start a new project (no API key needed — the starter
runs offline from a committed replay ledger):

```bash
npm create nola                                       # prompts for a name and a template
npm create nola my-app -- --template extract-resume   # non-interactive
cd my-app
npm install
npm start          # extracts typed data from prose, offline
```

Templates: `starter` (the default — typed extraction, runs offline), `empty`
(nola.config + tsconfig only), and the curated examples (`extract-resume`,
`extract-invoice`, `classify-message`, `chain-of-thought`, `research-notes`)
fetched from this repo. (`npm create nola-lang` is the same command under its
full name — `create-nola` is a thin alias of `create-nola-lang` — and `nola init`
runs the same flow.)

Already have a project? `npm create nola -- --add` (or `nola init --add`)
writes `nola.config.ts` and adds the packages to your existing `package.json`
— a bare interactive run offers this automatically when it finds a
`package.json`.

Both paths can also set up your editor: pick **VS Code** at the prompt (or
pass `--ide vscode`) and the CLI writes `.vscode/launch.json` (F5-debug your
`.tsi` files) plus `.vscode/extensions.json` recommending the Nola extension.

### Working on this repo

```bash
npm install
npm run build      # tsc -b across all packages (builds the vendored parser first)
npm test           # vitest — whole suite
npm run lint       # biome
```

### CLI

```bash
nola init [dir] [--template t|--add] [--ide vscode] [--agents <list>]  # scaffold or retrofit, optionally with .vscode setup
nola build [dir] [--out dist]   # compile .tsi → .js + .map, emit adjacent .d.tsi.ts
nola run <entry>                # run a .tsi/.js entry with the loader + nola.config.ts
nola check [dir]                # type-check lowered .tsi, positions mapped back to source
nola skill install [--agents <list>]                 # write agent skill files (Claude Code, Cursor, Copilot, AGENTS.md)
```

### Debugging

The loader is `--import`-able (the tsx model), so any `.tsi` or `.js`/`.ts` entry
runs — and debugs — under plain `node`:

```bash
node --import nola-lang/register src/main.tsi
```

The loader inlines source maps pointing back at the on-disk `.tsi` files, so VS
Code breakpoints bind directly in `.tsi` source, and `--enable-source-maps` makes
stack traces report `.tsi` positions. A `launch.json` for it (the Nola VS Code
extension offers this via "Add Configuration…" as **Nola: Launch File**):

```jsonc
{
  "type": "node",
  "request": "launch",
  "name": "Nola: Launch main",
  "program": "${workspaceFolder}/src/main.tsi",
  "runtimeArgs": ["--import", "nola-lang/register", "--enable-source-maps"],
  "cwd": "${workspaceFolder}"
}
```

`npm create nola` (or `nola init`) writes this configuration to `.vscode/launch.json`
when you accept the editor setup step. This is the debug path, not a production one —
build with `nola build` for deployment.

### Configuration

`nola.config.ts` at the project root is a typed, executable TS module. It is loaded
once, validated, and frozen — there is no runtime mutation API.

```ts
import { defineConfig } from "@nola-lang/runtime";
import { openai, mockProvider, fallback, withRetry, exponential } from "@nola-lang/providers";

export default defineConfig({
  providers: {
    default: withRetry(openai({ model: "gpt-5" }), exponential({ maxRetries: 3 })),
    fast: fallback([openai({ model: "gpt-5-mini" }), openai({ model: "gpt-5-nano" })]),
    mock: mockProvider([{ ticketId: "TCK-4711", isFraud: true }]),
  },
  forceProvider: process.env.CI ? "mock" : undefined,  // hermetic: overrides every ask
  observability: { logLevel: "info" },
});
```

- **Providers** are a named map; `default` is required. Built-in provider factories are
  imported from `@nola-lang/providers`. `openai()` reads `OPENAI_API_KEY` (override with
  `apiKeyEnv`), lazily at the first request, and takes an injectable `fetch` for
  proxies, custom agents, or test interception.
- **Resilience** is composition over the same `NolaProvider` interface: `withRetry`,
  `fallback`, `roundRobin`. Retries skip *definitive* errors (auth, bad request).
- **Routing** precedence, highest first: `forceProvider` → a middleware
  `ctx.provider` reassignment → `ask with <name>` / `.withProvider()` →
  `providers.default`.
- **Environments** are plain TS branching; `forceProvider` is the one runtime-enforced
  mechanism, so a pinned provider in a dependency can't leak a real API call in tests.

**Hooks** observe; **middleware** participates. Hooks receive `askStart`,
`providerRequest`/`providerResponse`, `validationFailed`, `retry`, and `askEnd` (with a
receipt carrying both the original and effective prompt, `servedBy`, attempts, tokens,
duration, and the `.tsi` source location). A throwing hook is swallowed; it can never
break resolution. Middleware wraps every resolution, may rewrite the prompt, re-route,
short-circuit (a cache returns `servedBy: "cache"`, `attempts: 0`), or fail the ask.

```ts
export default defineConfig({
  providers: { default: openai() },
  hooks: [{ name: "cost", onAskEnd: ({ receipt }) => report(receipt) }],
  middleware: [async (ctx, next) => { ctx.prompt += " Answer concisely."; return next(ctx); }],
});
```

A built-in logger ships as a hook — level from `observability.logLevel`, overridable by
the `NOLA_LOG` env var. Secrets are redacted from everything logged or stored in a
receipt. Tests and examples use `mockProvider(...)` for deterministic, network-free
runs. Config errors are reported with `NOLA3xxx` codes naming the file and field.

### Consuming `.tsi` from plain `tsc`

Set `"allowArbitraryExtensions": true` and import `./x.tsi`; the `nola build`-emitted
`x.d.tsi.ts` (written next to the source) supplies types. In-file IntelliSense inside
`.tsi` is a deferred Volar-tier language server.

### Importing plain TS from `.tsi`

Use the standard NodeNext `.js` specifier — `import { helper } from "./helpers.js"`
finds the on-disk `helpers.ts`. `nola check` and the editor map it natively, and
`nola run`'s loader falls back from a missing relative `./x.js` to `x.ts` (a real
on-disk `.js` always wins). A literal `./helpers.ts` import also runs (Node's
native type-stripping), but it needs `allowImportingTsExtensions` under `nola
check` and the specifier survives into built output where no `.ts` exists —
prefer the `.js` form.

## Examples

[`examples/`](examples/) holds six standalone projects covering the canonical
LLM-programming tasks: typed extraction (`extract-person`, `extract-resume`,
`extract-invoice`), classification over closed label sets (`classify-message`),
accumulating context (`chain-of-thought`), and TS control flow orchestrating
nola functions (`research-notes`). All run on the mock provider (no API key
needed):

```bash
npm run build
cd examples/extract-person
node ../../packages/nola-lang/dist/main.js run src/main.ts
# → {"name":"Alice Smith","age":32,"employer":"Acme Corp","job":"staff engineer"}
```

## Scope

Shipped: extractor and call intents, `ask` / `ask with`, `${}` prompt interpolation,
named providers with retry/fallback/round-robin, per-intent routing, hooks, receipts,
middleware, and the built-in logger.

Deferred (grammar and packages are shaped to accept them): abstract functions,
type/interface intents, `ask if/for/while/switch`, class methods, branch-scoped
contexts, Python (`.pyn`), the Volar language server + VS Code IntelliSense, and
Vite/webpack/esbuild/Jest adapters. On the config side: the `plugins` contract
(the key is reserved and rejected), scoped overrides, a record/replay provider, and
`nola doctor`. See the v2 spec's §9–10 and the config spec's §9 for the full lists.
