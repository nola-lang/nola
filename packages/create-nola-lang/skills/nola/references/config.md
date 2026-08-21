# `nola.config.ts`, providers, and project layout

## The import surface is FROZEN — use exactly these two specifiers

```ts
import { defineConfig } from "@nola-lang/runtime";
import { openai, mockProvider, withRetry } from "@nola-lang/providers";
```

`defineConfig` and everything app-facing come from `@nola-lang/runtime`.
Everything provider-shaped — provider factories (`openai`, `anthropic`,
`google`, `mockProvider`), resilience combinators (`withRetry`, `fallback`,
`roundRobin`, `constant`, `exponential`) and record/replay (`record`,
`replay`) — comes from `@nola-lang/providers`.

Never import providers from the runtime, never import `defineConfig` from the
providers package, and never reach for a subpath (`@nola-lang/runtime/config`,
`@nola-lang/runtime/providers`, `nola-lang/runtime`) — those do not exist.
`@nola-lang/providers` deliberately does not depend on the runtime, which is
what keeps a second copy of the runtime out of the install tree.

## Minimal config

`nola.config.ts` lives at the project root and default-exports a
`defineConfig` call. `providers.default` is required:

```ts
import { openai } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  providers: {
    // Reads OPENAI_API_KEY from the environment at the first ask.
    default: openai({ model: "gpt-5-mini" }),
  },
});
```

`openai({ model })` requires an explicit model; optional fields are `apiKey`,
`apiKeyEnv` (default `"OPENAI_API_KEY"`), `baseUrl` and `fetch`.

### Named providers become `ask with <name>` targets

Every other key of `providers` is a name you choose, and that name is exactly
what `ask with` and `.withProvider()` accept:

```ts
import { anthropic, openai } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  providers: {
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
NOLA3004, listing the configured names.

### Other config sections

```ts
import { mockProvider, openai } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  providers: {
    default: openai({ model: "gpt-5-mini" }),
    mock: mockProvider(() => ({ ok: true })),
  },
  // hermetic override — EVERY ask goes here, even .withProvider()-pinned ones
  forceProvider: process.env.CI ? "mock" : undefined,
  observability: { logLevel: "info" },
  ask: { timeoutMs: 60_000 },          // per-invocation timeout; 0 disables
  system: { message: "Answer in British English." },
  compiler: { underivableContextType: "error" },   // "error" | "prune" | "omit"
  build: { target: "app" },            // "app" (default) | "lib"
});
```

Keep `compiler.underivableContextType` a LITERAL value — the editor reads it
statically and cannot execute your config, so a computed value is invisible to
it.

### Resilience combinators

Combinators wrap a provider and return a provider, so they nest:

```ts
import { exponential, fallback, openai, withRetry } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  providers: {
    default: fallback([
      withRetry(openai({ model: "gpt-5-mini" }), exponential({ maxRetries: 3 })),
      openai({ model: "gpt-5-nano" }),
    ]),
  },
});
```

`withRetry(provider, policy)` takes a policy built by `constant({ maxRetries })`
or `exponential({ maxRetries, delayMs?, multiplier?, maxDelayMs? })`; it retries
the wire call and fail-fasts on definitive errors (most 4xx). It is unrelated to
the intent method `.withRetry(n)`, which re-runs the whole ask.

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
    "@nola-lang/providers": "^0.1.4",
    "@nola-lang/runtime": "^0.1.4"
  },
  "devDependencies": {
    "nola-lang": "^0.1.4",
    "typescript": "^5.6.0"
  },
  "engines": { "node": ">=22" }
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
- Scaffold a project with `npm create nola my-app`. (`nola init` is the same
  flow, but it ships in `nola-lang`, so it only exists once that is installed;
  `npx nola` before that resolves an unrelated npm package named `nola`.)

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
  providers: {
    default: mockProvider([{ name: "Alice Smith", age: 32 }]),
  },
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
  providers: {
    default: live
      ? record(openai({ model: "gpt-5-mini" }), "./nola.replay.jsonl")
      : replay("./nola.replay.jsonl"),
  },
});
```

`replay` is STRICT: entries are keyed by a fingerprint of the exact request, and
a request with no matching entry fails with NOLA3008 rather than quietly calling
the network. Any change to a prompt, an instruction, a schema or the provider
params re-keys the entry — re-record the ledger after editing a `.tsi`.

Secrets in production come from the real environment; `.env` files are a
dev-time convenience of the loader only.
