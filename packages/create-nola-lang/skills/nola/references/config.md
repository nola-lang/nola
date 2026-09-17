# `nola.config.ts`, providers, and project layout

## The import surface is FROZEN — use exactly these two specifiers

```ts
import { defineConfig, nola, terminalTrace } from "@nola-lang/runtime";
import { openai, mockProvider, withRetry } from "@nola-lang/providers";
```

`defineConfig`, the `nola` namespace (`nola.infer()`, `nola.tracer()`),
`terminalTrace()` and everything app-facing come from `@nola-lang/runtime`.
Everything bring-your-own — vendor factories (`openai`, `anthropic`,
`google`, `typesafe`, `mockProvider`), resilience combinators (`withRetry`, `fallback`,
`roundRobin`, `constant`, `exponential`) and record/replay (`record`,
`replay`) — comes from `@nola-lang/providers`.

Never import `nola` from the providers package or bring-your-own factories
from the runtime, never import `defineConfig` from the providers package, and
never reach for a subpath (`@nola-lang/runtime/config`,
`@nola-lang/runtime/providers`, `nola-lang/runtime`) — those do not exist.
`@nola-lang/providers` deliberately does not depend on the runtime, which is
what keeps a second copy of the runtime out of the install tree.

## Minimal config

`nola.config.ts` lives at the project root and default-exports a
`defineConfig` call. `provider` is required — one provider, or a named map
with a required `default` entry:

```ts
import { openai } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  // Reads OPENAI_API_KEY from the environment at the first ask.
  model: openai({ model: "gpt-5-mini" }),
});
```

`openai({ model })` requires an explicit model; optional fields are `apiKey`,
`apiKeyEnv` (default `"OPENAI_API_KEY"`), `baseUrl` and `fetch`.

`typesafe()` (typesafe.ai's Jev, reads `TYPESAFE_API_KEY`, model defaults to
`jev-latest`) is NOT a chat model: it serves only asks whose output type is a
string or number literal union, a boolean, or a flat object of those, and
fails definitively before the network on anything else. Use it behind
`fallback([typesafe(), openai({ model: "gpt-5-mini" })])` so other asks
escalate to a general model. Never scaffold it as the only model.

`nola` is a NAMESPACE, not a function (`nola({})` is a type error).
`nola.infer()` is the platform model — the Nola platform (api.nola.sh, or a
self-hosted console at `baseUrl`) serves inference and reads `NOLA_API_KEY`;
with no argument the platform picks the model:

```ts
import { defineConfig, nola } from "@nola-lang/runtime";
export default defineConfig({ model: nola.infer() });
```

When the platform serves, `ask with <name>` accepts ANY name — a configured
map key pins that model as usual, and any other name (`fast`, `careful`, …)
is sent with the request as a free-form inference profile that the
platform's routing resolves to a model and params server-side (no per-ask
temperature/topK tuning). A local model map keeps strict name validation
(unknown names are NOLA3004). `nola.infer("<provider>/<model>")` names the
upstream explicitly; `nola.infer({ baseUrl, apiKey, apiKeyEnv, retry, model })`
carries the connection. Beside your own models it is the map's `default`:
`model: { default: nola.infer(), fast: openai("gpt-5-nano") }`. Nothing else
is implied — traces go to the platform only when `telemetry` lists
`nola.tracer()`.

`npm create nola` asks *Select an inference provider:* right after the
template — Nola (25 free runs) first, then OpenAI / Anthropic / Gemini, then
skip — and for Nola writes this config plus the key into `.env` (a vendor gets
its own config, key left to the user); in an existing project `npx nola-lang
key` mints one (and `npx nola-lang init --add --provider nola` does that plus
the config and deps).
A machine gets one anonymous trial; later projects sign in
(`npx nola-lang login`, a browser sign-in that returns to a loopback port) and mint keys on the
user's Nola account. When the runs are gone an ask fails with `NolaProviderError.code ===
"quota_exceeded"` — `npx nola-lang account` opens the account page, where
prepaid balance is added (signing in when needed), no config change. Naming an upstream:

```ts
import { defineConfig, nola } from "@nola-lang/runtime";
export default defineConfig({ model: nola.infer("openai/gpt-5-mini") });
```

### Named providers become `ask with <name>` targets

`provider` may also be a map. `default` is required (a plain `ask` uses it);
every other key is a name you choose, and that name is exactly what
`ask with` and `.withModel()` accept:

```ts
import { anthropic, openai } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  model: {
    default: openai({ model: "gpt-5-mini" }),
    fast: openai({ model: "gpt-5-nano" }),
    careful: anthropic({ model: "claude-sonnet-4-5" }),
  },
});
```

```tsi
export infer function summarize(.text: string) {
  const draft = ask with fast ..`a rough summary`<string>;
  return ask with careful ..`a polished summary of: ${draft}`<string>;
}
```

An `ask with` name that is not a key of the map fails at run time with
NOLA3004, listing the configured names — EXCEPT when `default` is
`nola.infer()`, where the unmatched name becomes an inference profile for
the platform instead of an error.

### Other config sections

```ts
import { mockProvider, openai } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  model: {
    default: openai({ model: "gpt-5-mini" }),
    mock: mockProvider(() => ({ ok: true })),
  },
  project: "my-app",                   // names the app in traces/platform requests; defaults to package.json name
  // hermetic override — EVERY ask goes here, even .withModel()-pinned ones
  forceModel: process.env.CI ? "mock" : undefined,
  telemetry: { level: "info" },        // the terminal; absent = every event at debug; an observer or a list replaces it
  ask: { timeoutMs: 60_000 },          // per-invocation timeout; 0 disables
  system: { message: "Answer in British English." },
  compiler: { underivableContextType: "error" },   // "error" | "prune" | "omit"
  build: { target: "app" },            // "app" (default) | "lib"
});
```

`telemetry` is the ONE place events go — there is no `hooks` key. Its
value is `{ level? }` (the terminal alone: `terminalTrace({ level })`,
levels `silent` · `error` · `warn` · `info` · `debug`; absent = `{}` = every
event at `debug`, coloured on a TTY, written to STDERR — stdout stays the
program's), ONE observer, or an ARRAY of
observers. An observer or an array REPLACES the terminal — nothing is
implied, so list `terminalTrace()` to keep it; `[]` is silent. Observers:
`nola.tracer()` / `nola.tracer("http://localhost:4141")` /
`nola.tracer({ baseUrl, apiKey? })` (posts to a Nola-Protocol server;
keyless on loopback; never gated — listed means sends), `terminalTrace({
level })`, or any object with on* methods (`onAskStart`,
`onProviderRequest`, `onProviderResponse`, `onValidationFailed`, `onRetry`,
`onAskEnd`, `onInvocationStart`, `onInvocationEnd`; that shape is
`NolaTelemetry`). The global `console` is NOT an entry. `nola.infer()` does
NOT imply a tracer. `NOLA_TRACING_URL` appends `nola.tracer(url)`; a config
that lists a tracer itself wins, with a notice. Sending is fire-and-forget
and never affects inference. The platform model is root-only: it cannot
appear inside combinators or non-default map entries. Start the local
console with `npx nola-lang console` (loopback, first free port from 4141;
one instance per machine, traces stored in `~/.nola/console/data/console.db`;
needs Node >= 22.13); its terminal prints the same lines `terminalTrace()`
prints in the app.

Keep `compiler.underivableContextType` a LITERAL value — the editor reads it
statically and cannot execute your config, so a computed value is invisible to
it.

### Resilience combinators

Combinators wrap a provider and return a provider, so they nest:

```ts
import { exponential, fallback, openai, withRetry } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  model: fallback([
    withRetry(openai({ model: "gpt-5-mini" }), exponential({ maxRetries: 3 })),
    openai({ model: "gpt-5-nano" }),
  ]),
});
```

`withRetry(provider, policy)` takes a policy built by `constant({ maxRetries })`
or `exponential({ maxRetries, delayMs?, multiplier?, maxDelayMs? })`; it retries
the wire call and fail-fasts on definitive errors (most 4xx). It is unrelated to
the intent method `.withRetry(n)`, which re-runs the whole ask.

The platform-served model (root-only) manages its own resilience:
`withRetry`, `fallback`, and `roundRobin` REJECT it (config error). It
retries its own wire calls — on by default (2 retries, 500ms exponential backoff capped at
10s, honoring Retry-After, skipping definitive errors); tune or disable with
`nola.infer({ retry: { maxRetries?, delayMs?, multiplier?, maxDelayMs? } })` or
`nola.infer({ retry: false })`. `record()`/`replay()` still wrap it — they are
recording instruments, not resilience.

## Package layout

`nola-lang` is a DEV dependency — it holds the compiler, the CLI and
TypeScript, and never ships to production. The app depends on the runtime and
the providers package:

```json
{
  "type": "module",
  "scripts": {
    "start": "nola run src/main.ts",
    "build": "nola build",
    "check": "nola check"
  },
  "dependencies": {
    "@nola-lang/providers": "^0.1.10",
    "@nola-lang/runtime": "^0.1.10"
  },
  "devDependencies": {
    "nola-lang": "^0.1.10",
    "typescript": "^5.6.0"
  },
  "engines": { "node": ">=22.18" }
}
```

`nola-lang`, `@nola-lang/runtime` and `@nola-lang/providers` are released in
LOCKSTEP — give all three the same version (`npm create nola` pins them
for you). Do not mix versions.

- `nola run <entry>` runs a `.ts`/`.tsi` entry through the loader with
  `nola.config.ts` applied.
- `nola build [dir] [--out dist]` emits plain JS + source maps + `.d.ts`. For
  app projects (the default) it also emits `dist/nola.config.js` and wires
  every built module to it, so `node dist/main.js` needs no loader. Library
  authors set `build: { target: "lib" }` and let the consuming app configure
  the process.
- `nola check [dir]` type-checks `.tsi` and `.ts` together with diagnostics
  mapped back to `.tsi` positions. Plain `tsc` over `src` is NOT a check path.
- `npx nola-lang key` gets a key for the project (the machine's one free
  trial, else the signed-in account — signing in first when needed), then
  offers to add it to `.env` (and to replace an existing `NOLA_API_KEY`
  there); `--print` puts only the key on stdout. `npx nola-lang login` /
  `logout` manage the sign-in (`~/.nola/credentials.json`).
- `nola account` signs the user in when needed, prints the account's run
  counter and balance, and opens the account page in the browser
  (prepaid top-ups; every key of the account listed masked with a revoke
  action). Works from any directory; no key or token enters the URL.
- Scaffold a project with `npm create nola my-app`. (`nola init` is the same
  flow, but it ships in `nola-lang`; always invoke it as `npx nola-lang init` —
  a bare `npx nola` outside a project resolves an unrelated npm package named
  `nola`.)

## tsconfig.json

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "allowArbitraryExtensions": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`include` must be DIRECTORY-style (`["src"]`), never a `.ts`-suffixed glob
like `["src/**/*.ts"]`: the directory form is what lets the editor tooling
admit `.tsi` files into the program while plain `tsc` ignores them. Under the
glob form `.tsi` files fall out of the program and auto-import stops offering
your infer functions. `module`/`moduleResolution` are NodeNext (hence `./x.js`
specifiers for plain TS imports) and `allowArbitraryExtensions` is required
for the `.tsi` declaration pairs.

## Developing offline

`mockProvider` returns canned answers — deterministic, no API key, and the
right default for examples and tests. It takes either a queue of values (one
per ask, in order) or a function of the request:

```ts
import { mockProvider } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  model: mockProvider([{ name: "Alice Smith", age: 32 }]),
});
```

### record / replay

`record(inner, path)` wraps a real provider and appends every exchange to a
JSONL ledger; `replay(path)` serves answers back from that ledger:

```ts
import { openai, record, replay } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

const live = process.env.NOLA_RECORD === "1";

export default defineConfig({
  model: live
    ? record(openai({ model: "gpt-5-mini" }), "./nola.replay.jsonl")
    : replay("./nola.replay.jsonl"),
});
```

`replay` is STRICT: entries are keyed by a fingerprint of the rendered prompt
as first composed, and a request with no matching entry fails with NOLA3008
rather than quietly calling the network. Any change to a prompt, an
instruction, a schema or the provider params re-keys the entry — and so does a
Nola upgrade that rephrases the built-in wording — re-record the ledger after
editing a `.tsi` or upgrading.

Secrets in production come from the real environment; `.env` files are a
dev-time convenience of the loader only.
