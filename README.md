<p align="center">
  <a href="https://nola.sh">
    <img src="assets/nola-mark.svg" alt="Nola" width="150">
  </a>
</p>

<h3 align="center">ask the LLM in TypeScript</h3>

<p align="center">
  A TypeScript superset where inference is a language feature — ask for typed
  values, or let the model call your code.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/nola-lang"><img src="https://img.shields.io/npm/v/nola-lang?logo=npm&color=4EC9B0&label=nola-lang" alt="npm version"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=nola.nola-vscode"><img src="https://vsmarketplacebadges.dev/version-short/nola.nola-vscode.svg?color=4EC9B0&label=VS%20Code" alt="VS Code Marketplace"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A5%2022-4EC9B0?logo=nodedotjs&logoColor=white" alt="Node >= 22"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-4EC9B0" alt="Apache-2.0"></a>
  <a href="https://nola.sh/docs/"><img src="https://img.shields.io/badge/docs-nola.sh-4EC9B0" alt="Documentation"></a>
</p>

---

**Nola** is a TypeScript superset. Files end in `.tsi`, and everything you know
about TypeScript applies inside them — plus two constructs that make talking to a
language model part of the language rather than a library call. The toolchain
*lowers* `.tsi` to plain TypeScript before `tsc`, bundlers, Node, or your editor
ever see it, the same way JSX is compiled away.

```ts
// analyze.tsi
export infer function analyzeUserRequest(userId: string, .message: string) {
  const ticketId = ask ..`ticket id mentioned in the message`<string>;
  const isFraud = ask ..`does the message look fraudulent`<boolean>;
  return { userId, ticketId, isFraud };
}
```

```ts
// main.ts — plain TS imports the .tsi directly
import { analyzeUserRequest } from "./analyze.tsi";

const result = await analyzeUserRequest(
  "user-1",
  "Ticket TCK-4711: customer reports suspicious activity.",
);
// → { userId: "user-1", ticketId: "TCK-4711", isFraud: true }
```

`.message` is a *contextual* parameter — its value is shown to the model in every
`ask` of that invocation; `userId` is a plain argument the model never sees. The
TypeScript type *is* the schema: `<boolean>` is validated, and a `Date` comes back
as a real `Date`.

## Quick start

Requires **Node ≥ 22**. The starter needs no API key — it runs offline from a
committed replay ledger.

```bash
npm create nola          # prompts for a name, a template, editor + agent setup
cd my-app
npm install
npm start                # extracts typed data from prose, offline
```

Non-interactive, and for a project you already have:

```bash
npm create nola my-app -- --template extract-resume   # pick a template up front
npm create nola -- --add                              # retrofit the current project
```

`--add` writes `nola.config.ts` and merges the packages into your existing
`package.json`; a bare interactive run offers it automatically when it finds one.
Templates are `starter` (the default), `empty`, and the curated
[examples](examples/). `npm create nola-lang` is the same command under its full
name, and `nola init` runs the same flow from inside a project.

Prefer the CLI on your `PATH`?

```bash
npm i -g nola-lang       # gives you `nola` anywhere
nola init my-app
```

In a project, `nola-lang` belongs in `devDependencies` — it never ships to
production. Your app depends on `@nola-lang/runtime` and `@nola-lang/providers`.

**[Quick start →](https://nola.sh/docs/start/quick-start/)** ·
[Project anatomy →](https://nola.sh/docs/start/project-anatomy/) ·
[Add to an existing project →](https://nola.sh/docs/start/add-to-existing-project/)

## Editor support

[**Nola for VS Code**](https://marketplace.visualstudio.com/items?itemName=nola.nola-vscode)
gives `.tsi` files syntax highlighting, diagnostics, hover, completion and
go-to-definition through a Volar language server — and a bundled tsserver plugin
means plain `.ts` files that import a `.tsi` see full types. Breakpoints bind in
`.tsi` source: stepping into an infer function lands on its first statement.

```bash
code --install-extension nola.nola-vscode
```

Scaffolding writes `.vscode/launch.json` and `.vscode/extensions.json` for you if
you accept the editor step (or pass `--ide vscode`). Keep `.tsi` files inside a
directory-style tsconfig `include` (`["src"]`, never `["src/**/*.ts"]`) so the
editor can admit them.

**[Editor setup →](https://nola.sh/docs/start/editor-setup/)** ·
[VS Code extension →](https://nola.sh/docs/tooling/vscode/)

## Agent skill

Nola ships a skill that teaches coding agents to write it — syntax, configuration,
patterns and pitfalls, versioned with the release you installed.

```bash
nola skill install --agents claude,cursor,copilot,agents-md
```

| Agent | What it writes |
|---|---|
| Claude Code | `.claude/skills/nola/` — the full skill directory + references |
| Cursor | `.cursor/rules/nola.mdc` |
| GitHub Copilot | `.github/instructions/nola.instructions.md` |
| Other agents (Codex, Gemini CLI, …) | `AGENTS.md` |

A bare `nola skill install` detects which agents the project already uses. Each
file carries a version stamp, so a later run reports what has gone stale and
`--force` refreshes it. The source is
[`packages/create-nola-lang/skills/nola/`](packages/create-nola-lang/skills/nola/);
the scaffolder offers the same step as `--agents`.

## The core constructs

| Construct | Syntax | Meaning |
|---|---|---|
| **Nola function** | `infer function name(…) { … }` — optionally `` name`instruction`(…) `` | The mounting point: importable from plain TS/JS. Calling it runs nothing; it returns a lazy, thenable `Intent<T>`. `await` is legal in the body for ordinary promises. |
| **Contextual parameter** | `.name: T` | The argument's value joins the prompt of every `ask` in the invocation. Plain parameters contribute name and type only. *One dot in, two dots out.* |
| **Extractor** | `` ..`instruction`<T> `` | A request to pull a `T` from context. Supports `${}` interpolation; may be constructed anywhere; resolved with `ask`. |
| **`ask` operator** | `ask <intent>` | Resolves an intent the way `await` resolves a promise. Legal only directly inside an infer function body. `ask` is a reserved word in `.tsi`. |
| **Provider routing** | `ask with <name> <intent>` | Resolves one ask through a named provider from `nola.config.ts` (static identifier; `.withProvider()` is the dynamic form). |
| **Call intent** | `` fn`hint`(…) `` or a plain call with an extractor argument, `` fn(..`x`<T>, …) `` | The model fills the extractor-shaped arguments, then the function is called; async results are awaited. Only the hint form carries instruction text. |
| **Prompt template** | `${.member}` inside any instruction literal | Reads the intent's prompt scope (`.default`, `.next`, `.type`, `.args`, …); the literal then replaces that intent's built-in prompt block. |
| **Intent methods** | `.withRetry(n)` · `.withProvider()` · `.withParams()` · `.withTimeout()` · `.detached()` | Per-intent knobs; each clones the intent. The last two exist only on the `Intent` an infer function returns. |

Typed extractors derive a JSON Schema at compile time from `string`, `number`,
`boolean`, `Date`, arrays, inline object literals, string-literal unions and string
enums, and named aliases/interfaces from the same file or imported from another
(recursive types included); JSDoc comments on members become schema descriptions.

**[The mental model →](https://nola.sh/docs/language/mental-model/)** ·
[Syntax cheatsheet →](https://nola.sh/docs/reference/syntax-cheatsheet/)

## Documentation

Full documentation lives at **[nola.sh/docs](https://nola.sh/docs/)**. Its source is
in this repo under [`docs-site/`](docs-site/) — the pages are Starlight `.mdx`, so
read them on the site rather than here, but edit them there.

| | |
|---|---|
| **Start** | [Quick start](https://nola.sh/docs/start/quick-start/) · [Project anatomy](https://nola.sh/docs/start/project-anatomy/) · [Add to an existing project](https://nola.sh/docs/start/add-to-existing-project/) · [Editor setup](https://nola.sh/docs/start/editor-setup/) |
| **Language** | [Mental model](https://nola.sh/docs/language/mental-model/) · [infer functions](https://nola.sh/docs/language/infer-functions/) · [Contextual parameters](https://nola.sh/docs/language/contextual-parameters/) · [Extractors](https://nola.sh/docs/language/extractors/) · [ask](https://nola.sh/docs/language/ask/) · [Call intents](https://nola.sh/docs/language/call-intents/) · [Intent methods](https://nola.sh/docs/language/intent-methods/) · [Prompt templates](https://nola.sh/docs/language/prompt-templates/) · [TypeScript interop](https://nola.sh/docs/language/typescript-interop/) · [Restrictions](https://nola.sh/docs/language/restrictions/) |
| **Configuration** | [nola.config.ts](https://nola.sh/docs/config/nola-config/) · [Providers](https://nola.sh/docs/config/providers/) · [Resilience](https://nola.sh/docs/config/resilience/) · [Ask options](https://nola.sh/docs/config/ask-options/) · [Observability](https://nola.sh/docs/config/observability/) · [Record and replay](https://nola.sh/docs/config/record-and-replay/) · [Environments and secrets](https://nola.sh/docs/config/environments-and-secrets/) |
| **Guides** | [Typed extraction](https://nola.sh/docs/guides/typed-extraction/) · [Classification](https://nola.sh/docs/guides/classification/) · [Function calling](https://nola.sh/docs/guides/function-calling/) · [Error handling](https://nola.sh/docs/guides/error-handling/) · [Testing without a network](https://nola.sh/docs/guides/testing/) · [Deploying](https://nola.sh/docs/guides/deploying/) |
| **Tooling** | [The nola CLI](https://nola.sh/docs/tooling/cli/) · [The Node loader](https://nola.sh/docs/tooling/node-loader/) · [VS Code extension](https://nola.sh/docs/tooling/vscode/) |
| **Reference** | [Syntax cheatsheet](https://nola.sh/docs/reference/syntax-cheatsheet/) · [Config schema](https://nola.sh/docs/reference/config-schema/) · [Intent API](https://nola.sh/docs/reference/intent-api/) · [Providers API](https://nola.sh/docs/reference/providers-api/) · [Error codes](https://nola.sh/docs/reference/error-codes/) |
| **Compared** | [BAML](https://nola.sh/docs/compare/baml/) · [Vercel AI SDK](https://nola.sh/docs/compare/vercel-ai-sdk/) · [LangGraph](https://nola.sh/docs/compare/langgraph/) |

### The CLI at a glance

```bash
nola init [dir]        # scaffold or retrofit (--template · --add · --ide · --agents)
nola build [dir]       # .tsi → .js + .map + .d.ts into --out
nola run <entry>       # run a .tsi/.ts entry with the loader + nola.config.ts
nola check [dir]       # type-check lowered .tsi and your .ts, mapped back to source
nola declarations      # adjacent <name>.d.tsi.ts so plain tsc resolves .tsi imports
nola skill install     # write agent skill files
```

The loader is `--import`-able (the tsx model), so any entry runs — and debugs —
under plain `node`: `node --import nola-lang/register src/main.tsi`. That's the
development path; build with `nola build` for deployment.

## How it works

```
source.tsi
  → @nola-lang/parser  (vendored @babel/parser + `nola` plugin) → Nola AST (lossless locations)
  → @nola-lang/compiler (magic-string span replacement)         → plain TS + source map
      ├─ nola build   → esbuild type-strip → dist/*.js + .map + .d.ts (+ a self-configuring nola.config.js)
      ├─ nola run     → same transform in-memory via a module.register loader
      ├─ nola check   → tsc API over lowered TS + your plain .ts → diagnostics remapped to .tsi
      ├─ bundlers     → @nola-lang/vite | webpack | rollup | rolldown | esbuild | rspack | next
      └─ editor       → Volar virtual code → VS Code extension (LSP + tsserver plugin)
```

Nola is **not** valid TypeScript, so `tsserver`/`tsc` can't parse it directly. Nola
owns the parse (a vendored Babel 8 fork with a `nola` internal plugin) and only ever
hands *lowered plain TS* to `tsc` — no tsc fork, no tsc plugin. This is the same
approach Vue and Svelte take. Nola is **server-only in v0**: a client bundle that
imports `.tsi` fails at build time.

## Packages

All packages are versioned in lockstep.

| Package | Role |
|---|---|
| `nola-lang` | The dev tool (devDependency): `nola init` / `build` / `run` / `check` / `declarations` / `skill` + the `nola-lang/register` loader hook |
| `create-nola-lang` | `npm create nola-lang` — interactive scaffolding (templates and the prompt flow; `nola init` reuses both) |
| `create-nola` | `npm create nola` — short alias; its bin forwards to `create-nola-lang` |
| `@nola-lang/runtime` | The app dependency: intent resolution, validator, `defineConfig`, hooks, receipts, logger |
| `@nola-lang/providers` | Everything provider-shaped: `openai`, `anthropic`, `google`, `mockProvider`, resilience combinators, record/replay |
| `@nola-lang/core` | `Intent<T>` / `Askable<T>` types, provider/config/hook contracts, errors, redaction, fingerprints (dependency-free) |
| `@nola-lang/ast` | Nola AST node types, visitors, diagnostic codes |
| `@nola-lang/parser` | `.tsi` source → Nola AST with structured diagnostics |
| `@nola-lang/compiler` | AST → plain TS + source map; schema derivation; companion modules |
| `@nola-lang/node-loader` | `module.register` hooks + `nola.config.ts` loading/bundling |
| `@nola-lang/language-core` | Volar virtual-code plugin over the lowering (editor-agnostic) |
| `@nola-lang/language-server` | The LSP server (diagnostics, hover, completion, definition) |
| `@nola-lang/typescript-plugin` | tsserver plugin: `.ts` files importing `.tsi` get full types and go-to-definition |
| `nola-vscode` | The VS Code extension: highlighting, language server, debug launch snippet |
| `@nola-lang/unplugin` + `@nola-lang/vite` / `webpack` / `rollup` / `rolldown` / `esbuild` / `rspack` | Bundler plugins — one unplugin core, thin named wrappers |
| `@nola-lang/next` | `withNola` for Next.js (webpack + Turbopack, server-only) |
| `@nola-lang/babel-parser` | Vendored `@babel/parser` (v8.0.0-rc.6) with the `nola` plugin — private |

## Examples

[`examples/`](examples/) holds standalone projects covering the canonical
LLM-programming tasks — typed extraction, classification over closed label sets,
multi-step reasoning, contextual parameters, prompt templates, cross-file and
recursive types, and TS control flow orchestrating nola functions. All run on the
mock provider, so no API key is needed. Several are also scaffoldable:
`npm create nola my-app -- --template extract-resume`.

```bash
npm run build
cd examples/extract-person
node ../../packages/nola-lang/dist/main.js run src/main.ts
# → {"name":"Alice Smith","age":32,"employer":"Acme Corp","job":"staff engineer"}
```

**[Examples on the docs site →](https://nola.sh/docs/examples/)**

## Contributing

Node **≥ 22**, npm workspaces.

```bash
npm install
npm run build      # builds the vendored parser first, then tsc -b across packages
npm test           # vitest — whole suite
npm run lint       # biome
```

Documentation changes are made in [`docs-site/`](docs-site/), not in the site repo —
so a syntax change and the docs describing it land in the same commit. The
agent-facing language reference lives in
[`packages/create-nola-lang/skills/nola/`](packages/create-nola-lang/skills/nola/)
and moves with the surface it describes.

## License

[Apache-2.0](LICENSE)
