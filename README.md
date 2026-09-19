<p align="center">
  <a href="https://nola.sh">
    <img src="assets/nola-mark.svg" alt="Nola" width="150">
  </a>
</p>

<h3 align="center">AI inference, expressed in TypeScript</h3>

<p align="center">
  Nola extends TypeScript with syntax that makes working with AI models feel
  native — much as <code>async</code> / <code>await</code> did for asynchronous code.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/nola-lang"><img src="https://img.shields.io/npm/v/nola-lang?logo=npm&color=4EC9B0&label=nola-lang" alt="npm version"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=nola.nola-vscode"><img src="https://vsmarketplacebadges.dev/version-short/nola.nola-vscode.svg?color=4EC9B0&label=VS%20Code" alt="VS Code Marketplace"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A5%2022.18-4EC9B0?logo=nodedotjs&logoColor=white" alt="Node >= 22.18"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-4EC9B0" alt="Apache-2.0"></a>
  <a href="https://nola.sh/docs/"><img src="https://img.shields.io/badge/docs-nola.sh-4EC9B0" alt="Documentation"></a>
</p>

---

JSX made markup a language feature. **Nola** does the same for inference. A
`.tsi` file reads like TypeScript — but `tsc` never sees it: Nola owns the
parse, lowers every `ask` to plain TypeScript, and a provider fills in the type
at run time. This is the whole program:

```ts
// main.tsi
`Ada Lovelace, 36, worked with Charles Babbage on the Analytical Engine as a mathematician.`;

interface Person {
  name: string;
  age: number;
  job: string;
}

const person = ask `the described person`<Person>;

console.log(person);
// → { name: "Ada Lovelace", age: 36, job: "mathematician" }
```

Three things are happening here, and they are most of the language:

- **The type is the contract.** `Person` is an ordinary TypeScript interface.
  Its JSON Schema is derived at compile time, the reply is validated against it
  at run time, and a drifting reply gets one correction retry before the ask
  fails loudly. No Zod, no schema object, no `as Person`.
- **`ask` resolves an intent the way `await` resolves a promise.**
  `` ask `instruction`<T> `` is an *extractor* — ask the model for a `T`. It is
  legal at the top level of a `.tsi` file, so a script is a program.
- **Context is part of the language, not a string you assemble.** The template
  literal on the first line is the instruction the model reads before every
  `ask` in the file. Inside a function, context is a *parameter*.

Run it with `node --import nola-lang/register main.tsi`, or scaffold a project
that runs it with `npm start` — see [Quick start](#quick-start).

## The vocabulary

You already know this grammar. `infer` stands where `async` stood, `ask` where
`await` stood, `Intent` where `Promise` stood. Everything else keeps its shape:

```ts
// users.ts — concurrency
async function loadUser(id: string): Promise<User> {
  const user = await fetchUser(id);
  return user;
}
```

```ts
// users.tsi — inference
import type { Intent } from "@nola-lang/runtime";

infer function extractUser(.bio: string): Intent<User> {
  const user = ask `the user described`<User>;
  return user;
}
```

Same file, one letter apart — the `i` in `.tsi` is inference.

An `infer function` is the library shape of the program above. Plain TypeScript
imports the `.tsi` file directly and awaits the result:

```ts
// person.tsi
export interface Person { name: string; age: number; employer: string }

export infer function extractPerson(.bio: string) {
  return ask `extract the person`<Person>;
}
```

```ts
// main.ts — plain TypeScript imports the .tsi directly
import { extractPerson } from "./person.tsi";

const person = await extractPerson("Alice Smith, 32, is a staff engineer at Acme Corp.");
// → { name: "Alice Smith", age: 32, employer: "Acme Corp" }
```

The dot is the whole API. `.bio` is a **contextual parameter**: its value is
composed into the prompt of every `ask` in the call. A plain parameter stays an
ordinary JavaScript argument — its name and type reach the model, its value
never does. *One dot in, two dots out.*

## There isn't much to learn

Six ideas, and you've seen the whole language.

**Typed extractors — the type is the schema.** Ask for a string, a union, an
interface, an array, a `Date`. Named types, cross-file types and recursive
types all derive; JSDoc comments become schema descriptions and JSDoc tags
(`@format email`, `@minimum 13`, `@integer`) become validation keywords.

```ts
export infer function triage(.ticket: string) {
  const severity = ask `the severity`<"low" | "medium" | "high">;
  const orderIds = ask `every order id mentioned`<string[]>;
  return { severity, orderIds };
}
```

**Decision types — classification with probabilities.** `Choice<…>`, `Scale<…>`
and `Prob` are answer types for questions with a closed answer set. The model
returns a distribution, not a guess, and `confidence` tells you how sure it was.

```ts
`I was charged twice for order #4821 and nobody answers my emails. I want my money back today.`;

interface Triage {
  /** Which team should handle this? */
  team: Choice<{ billing: "Payments and refunds"; support: "Everything else" }>;
  /** How frustrated is the customer? */
  mood: Scale<["Calm", "Civil", "Angry"]>;
  /** Does the message express urgency? */
  urgent: Prob;
}

const triage = ask `triage the support ticket`<Triage>;
// → { team: { choice: "billing", probabilities: { billing: 0.94, support: 0.06 }, confidence: 0.91 },
//     mood: { score: 1.72, levels: ["Calm", "Civil", "Angry"], … }, urgent: 0.97 }
```

**Call intents — `ask` can infer actions.** Put extractors in a function's
argument slots and the model fills them in one provider call; then your code
runs as code. Nothing to register, no tool schema, no dispatch loop.

```ts
`Checkout shows a blank page after paying, and I was charged twice.`;

function createTicket(title: string, priority: number) {
  console.log(`created [p${priority}] ${title}`);
  return "T-4821";
}

const id = ask createTicket(
  ..`a short ticket title`<string>,
  ..`priority 1-5, where 1 is most urgent`<number>,
);
// created [p1] Blank page and double charge at checkout
```

**Routing is a keyword.** `ask with <name>` chooses who resolves an ask. The
names are keys of the `model` map in `nola.config.ts` — OpenAI, Anthropic,
Google, typesafe.ai, any OpenAI-compatible endpoint or the hosted Nola
Platform, wrapped in `withRetry` / `fallback` / `roundRobin`, plus a
deterministic `mockProvider` and record/replay ledgers for tests. The fleet
lives in config, not in your code.

```ts
export infer function summarize(.text: string) {
  const draft = ask with fast `a rough summary`<string>;
  return ask with careful `a polished summary of: ${draft}`<string>;
}
```

**Lazy by design.** Calling an infer function returns an `Intent<T>` — thenable
like a `Promise<T>`, but nothing reaches a provider until you await it. Until
then it is a value you can shape; every method clones it, and an intent
resolves at most once.

```ts
const intent = summarize(article);                     // Intent<string> — nothing has run
const tuned = intent.withRetry(2).withParams({ temperature: 0.2 });
const result = await tuned.withTimeout(30_000);        // one provider call, here
```

**Types as values.** Every exported type in a `.tsi` file is also a value:
`Signup.toJsonSchema()`, `Signup.validate(data)` and `Signup.parse(data)` work
with no model configured at all, and implement Standard Schema, so any library
that accepts one accepts a Nola type.

**[The mental model →](https://nola.sh/docs/language/mental-model/)** ·
[Syntax cheatsheet →](https://nola.sh/docs/reference/syntax-cheatsheet/)

## Why syntax beats a library

An SDK call spreads one decision across a schema, a prompt, and a type that
must stay in sync. Nola makes it a single typed expression that the compiler,
editor, and runtime all understand. Not one import: `infer` and `ask` are the
language, not a package. The contract is the TypeScript type you already have.
Chaining is ordinary interpolation, and a second `ask` still sees `.message`,
because context belongs to the function, not to one call.

The same task is implemented in Nola and in each alternative under
[`comparisons/`](comparisons/) — the Vercel AI SDK, LangChain.js, BAML, Ax and
the plain OpenAI SDK, each following its current documentation.

**[Why Nola →](https://nola.sh/docs/start/why-nola/)** ·
[Compared →](https://nola.sh/docs/compare/)

## Quick start

Requires **Node ≥ 22.18**.

```bash
npm create nola
```

The scaffolder asks for a name and a template. The first menu is one template
per feature: `feature-extraction` (the default — one `.tsi` file whose top-level
`ask` extracts typed data), `function-calling` (the same shape, calling an async
function from a `.ts` file next to it), `typescript-interop` (an `infer function`
imported and awaited from plain TypeScript), `triage-ticket` (ticket triage on
typesafe.ai's non-chat model) and `empty`, plus a *More examples…* row that opens
the curated [examples](examples/).

Then it asks for an inference provider: **nola** (free hosted runs, no API key
required), **OpenAI**, **Anthropic**, **Gemini**, **typesafe.ai**, or *Skip for
now*. A vendor choice writes that vendor's config and a `.env.example` naming
its key. Skip and the offline templates run from a committed replay ledger — no
key, no network.

Every new project also gets a `.vscode/launch.json` for F5 debugging, a
recommendation for the Nola extension, and the Nola agent skill for your coding
agents (`--ide none` and `--agents none` opt out). It ends by offering to install
dependencies and open the project in VS Code with the entry file active, so the
next steps are already done:

```bash
cd nola-app
npm install
npm start          # nola run src/main.tsi
```

Non-interactive, and for a project you already have:

```bash
npm create nola my-app -- --template extract-resume   # pick a template up front
npm create nola -- --add                              # retrofit the current project
```

`--add` writes `nola.config.ts` and merges the packages into your existing
`package.json`; a bare interactive run offers it automatically when it finds one.
`npm create nola-lang` is the same command under its full name, `pnpm create
nola` / `yarn create nola` / `bun create nola` work the same, and `nola init`
runs the same flow from inside a project.

Switch on a real provider whenever you like — edit `nola.config.ts`:

```ts
// nola.config.ts
import { openai } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  // Reads OPENAI_API_KEY from the environment at the first ask.
  model: openai({ model: "gpt-5-mini" }),
});
```

`anthropic({ model })`, `google({ model })` and `typesafe()` work the same way;
`model: "nola"` uses the hosted platform. Put the key in `.env` (the dev loader
reads it; production reads the real environment) and run `npm start` again.

Then check and build:

```bash
npx nola-lang check    # type-checks .tsi and .ts together, positions mapped back to .tsi
npx nola-lang build    # lowers every .tsi into dist/ (+ a self-configuring dist/nola.config.js)
```

Prefer the CLI on your `PATH`? `npm i -g nola-lang` gives you `nola` anywhere.
In a project, `nola-lang` belongs in `devDependencies` — it never ships to
production. Your app depends on `@nola-lang/runtime` and `@nola-lang/providers`.

**[Quick start →](https://nola.sh/docs/start/quick-start/)** ·
[Project anatomy →](https://nola.sh/docs/start/project-anatomy/) ·
[Add to an existing project →](https://nola.sh/docs/start/add-to-existing-project/)

## Editor support

[**Nola for VS Code**](https://marketplace.visualstudio.com/items?itemName=nola.nola-vscode)
gives `.tsi` files syntax highlighting, diagnostics, hover, completion and
go-to-definition through a Volar language server — and a bundled tsserver plugin
means plain `.ts` files that import a `.tsi` see full types. Lowered TS carries a
source map back to `.tsi`, so breakpoints bind in the file you wrote: F11 into an
infer function lands on its first statement.

```bash
code --install-extension nola.nola-vscode
```

Keep `.tsi` files inside a directory-style tsconfig `include` (`["src"]`, never
`["src/**/*.ts"]`) so the editor can admit them.

**[Editor setup →](https://nola.sh/docs/start/editor-setup/)** ·
[VS Code extension →](https://nola.sh/docs/tooling/vscode/)

## Agent skill

Nola ships a skill that teaches coding agents to write it — syntax, configuration,
patterns and pitfalls, versioned with the release you installed. The scaffolder
writes it by default; in an existing project:

```bash
npx nola-lang skill install --agents claude,universal,agents-md
```

| Target | What it writes |
|---|---|
| `universal` | `.agents/skills/nola/` — the open Agent Skills location (Cursor, Copilot, Codex, Gemini CLI, …) |
| `claude` | `.claude/skills/nola/` — a symlink to the `universal` directory when both are written, a full copy on its own (Claude Code) |
| `agents-md` | `AGENTS.md` — the skill body inline, for agents that read only that file |

The same layout comes out of the community CLI: `npx skills add nola-lang/nola`.
Each copy carries a version stamp, so a later run reports what has gone stale and
`--force` refreshes it. The source is
[`packages/create-nola-lang/skills/nola/`](packages/create-nola-lang/skills/nola/).

## Every ask, on the record

The runtime emits an event for each step of an ask and a receipt when it
finishes. `npx nola-lang console` starts a local console that stores that stream
in a per-machine SQLite file and lays it out as a tree — project → trace (one
top-level call with every nested call and ask underneath it) → ask (the prompt
as sent, the schema it was checked against, which provider answered, the
outcome, how long it took) → attempt (one provider round trip; a validation
miss and its correction turn show up as two).

```bash
npx nola-lang console                  # http://localhost:4141
NOLA_TRACING_URL=http://localhost:4141 npm start
```

Ingestion is fire-and-forget: a console that is down warns once and never
blocks, slows or fails an ask. Loopback only, and content is redacted before it
leaves the process. `terminalTrace()` prints the same lines to stderr, and any
observer you write sees the same events.

**[Observability →](https://nola.sh/docs/config/observability/)**

## Documentation

Full documentation lives at **[nola.sh/docs](https://nola.sh/docs/)**. Its source is
in this repo under [`docs-site/`](docs-site/) — the pages are Starlight `.mdx`, so
read them on the site rather than here, but edit them there.

| | |
|---|---|
| **Start** | [Quick start](https://nola.sh/docs/start/quick-start/) · [Why Nola](https://nola.sh/docs/start/why-nola/) · [Project anatomy](https://nola.sh/docs/start/project-anatomy/) · [Add to an existing project](https://nola.sh/docs/start/add-to-existing-project/) · [Editor setup](https://nola.sh/docs/start/editor-setup/) |
| **Language** | [Mental model](https://nola.sh/docs/language/mental-model/) · [infer functions](https://nola.sh/docs/language/infer-functions/) · [Contextual parameters](https://nola.sh/docs/language/contextual-parameters/) · [Extractors](https://nola.sh/docs/language/extractors/) · [ask](https://nola.sh/docs/language/ask/) · [Call intents](https://nola.sh/docs/language/call-intents/) · [Decision types](https://nola.sh/docs/language/decision-types/) · [Types as values](https://nola.sh/docs/language/types-as-values/) · [Intent](https://nola.sh/docs/language/intent/) · [Intent methods](https://nola.sh/docs/language/intent-methods/) · [Prompt templates](https://nola.sh/docs/language/prompt-templates/) · [TypeScript interop](https://nola.sh/docs/language/typescript-interop/) · [Restrictions](https://nola.sh/docs/language/restrictions/) |
| **Configuration** | [nola.config.ts](https://nola.sh/docs/config/nola-config/) · [Providers](https://nola.sh/docs/config/providers/) · [Resilience](https://nola.sh/docs/config/resilience/) · [Ask options](https://nola.sh/docs/config/ask-options/) · [Observability](https://nola.sh/docs/config/observability/) · [Record and replay](https://nola.sh/docs/config/record-and-replay/) · [Environments and secrets](https://nola.sh/docs/config/environments-and-secrets/) |
| **Guides** | [Typed extraction](https://nola.sh/docs/guides/typed-extraction/) · [Classification](https://nola.sh/docs/guides/classification/) · [Function calling](https://nola.sh/docs/guides/function-calling/) · [Types without a model](https://nola.sh/docs/guides/types-without-a-model/) · [Error handling](https://nola.sh/docs/guides/error-handling/) · [Testing without a network](https://nola.sh/docs/guides/testing/) · [Deploying](https://nola.sh/docs/guides/deploying/) |
| **Tooling** | [The nola CLI](https://nola.sh/docs/tooling/cli/) · [The Node loader](https://nola.sh/docs/tooling/node-loader/) · [VS Code extension](https://nola.sh/docs/tooling/vscode/) |
| **Reference** | [Syntax cheatsheet](https://nola.sh/docs/reference/syntax-cheatsheet/) · [Schema derivation](https://nola.sh/docs/reference/schema-derivation/) · [Config schema](https://nola.sh/docs/reference/config-schema/) · [Intent API](https://nola.sh/docs/reference/intent-api/) · [Providers API](https://nola.sh/docs/reference/providers-api/) · [Error codes](https://nola.sh/docs/reference/error-codes/) |
| **Compared** | [BAML](https://nola.sh/docs/compare/baml/) · [Vercel AI SDK](https://nola.sh/docs/compare/vercel-ai-sdk/) · [LangGraph](https://nola.sh/docs/compare/langgraph/) |

### The CLI at a glance

```bash
nola init [dir]        # scaffold or retrofit (--template · --add · --provider · --ide · --agents)
nola run <entry>       # run a .tsi/.ts entry with the loader + nola.config.ts
nola build [dir]       # .tsi → .js + .map + .d.ts into --out
nola check [dir]       # type-check lowered .tsi and your .ts, mapped back to source
nola console           # the local traces console (loopback only)
nola skill install     # write the agent skill (.claude/skills, .agents/skills) and/or AGENTS.md
nola declarations      # adjacent <name>.d.tsi.ts so plain tsc resolves .tsi imports
nola key | login | logout | account   # a hosted-platform key for this project, and your account
```

The loader is `--import`-able (the tsx model), so any entry runs — and debugs —
under plain `node`: `node --import nola-lang/register src/main.tsi`. That's the
development path; build with `nola build` for deployment.

## How it works

```
source.tsi
  → @nola-lang/parser   (vendored @babel/parser + `nola` plugin)  → Nola AST (lossless locations)
  → @nola-lang/compiler (magic-string span replacement)           → plain TS + source map
  → @nola-lang/derive   (the TypeScript checker)                  → schemas for every type an ask names
      ├─ nola run     → in-memory via a module.register loader, types stripped by Node itself
      ├─ nola build   → esbuild → dist/*.js + .map + .d.ts (+ a self-configuring nola.config.js)
      ├─ nola check   → tsc API over lowered TS + your plain .ts → diagnostics remapped to .tsi
      ├─ bundlers     → @nola-lang/vite | webpack | rollup | rolldown | esbuild | rspack | next
      └─ editor       → Volar virtual code → VS Code extension (LSP + tsserver plugin)
```

Nola is **not** valid TypeScript, so `tsserver`/`tsc` can't parse it directly. Nola
owns the parse (a vendored Babel 8 fork with a `nola` internal plugin) and only ever
hands *lowered plain TS* to `tsc` — no tsc fork, no tsc plugin. This is the same
approach Vue and Svelte take. Lowering is byte-identical outside the replaced
spans, so line numbers survive into the debugger. Nola is **server-only**: a client
bundle that imports `.tsi` fails at build time.

## Packages

All packages are versioned in lockstep.

| Package | Role |
|---|---|
| `nola-lang` | The dev tool (devDependency): the `nola` CLI + the `nola-lang/register` loader hook |
| `create-nola-lang` | `npm create nola-lang` — interactive scaffolding (templates, the prompt flow, the agent skill; `nola init` reuses all three) |
| `create-nola` | `npm create nola` — short alias; its bin forwards to `create-nola-lang` |
| `@nola-lang/runtime` | The app dependency: intent resolution, validation, `defineConfig`, telemetry, receipts |
| `@nola-lang/providers` | Everything provider-shaped: `openai`, `anthropic`, `google`, `typesafe`, `mockProvider`, resilience combinators, record/replay |
| `@nola-lang/core` | `Intent<T>` / `Askable<T>` types, provider/config/telemetry contracts, errors, redaction, fingerprints (dependency-free) |
| `@nola-lang/ast` | Nola AST node types, visitors, diagnostic codes |
| `@nola-lang/parser` | `.tsi` source → Nola AST with structured diagnostics |
| `@nola-lang/compiler` | AST → plain TS + source map + derivation requests |
| `@nola-lang/derive` | Schema derivation over the TypeScript checker |
| `@nola-lang/node-loader` | `module.register` hooks + `nola.config.ts` loading/bundling |
| `@nola-lang/console` | `nola console` — the local traces store (SQLite) and API, serving the bundled UI |
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
multi-step reasoning, contextual parameters, prompt templates, JSDoc constraints,
cross-file and recursive types, call intents, and TS control flow orchestrating
nola functions. All but one run on the mock provider, so no API key is needed.
Several are also scaffoldable: `npm create nola my-app -- --template extract-resume`.

```bash
npm run build
cd examples/extract-person
node ../../packages/nola-lang/dist/main.js run src/main.ts
# → {"name":"Alice Smith","age":32,"employer":"Acme Corp","job":"staff engineer"}
```

**[Examples on the docs site →](https://nola.sh/docs/examples/)**

## Contributing

Node **≥ 22.18**, npm workspaces.

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
