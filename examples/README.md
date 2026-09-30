# Nola examples

Each example is a standalone npm workspace. Most keep the library shape —
`src/*.tsi` (the Nola source) and `src/main.ts` (a plain TypeScript consumer,
run via `npx nola run src/main.ts`) — with a `nola.config.ts` on the
deterministic mock provider, so the example runs without an API key (switch
to a real provider by editing the config — the comment inside shows how).
Four are the one-file script shape instead (`ask` at the top level, a
`const .x` context binding, a context statement — `src/main.tsi` is the
program, run via `npx nola run src/main.tsi`): `feature-extraction`,
`function-calling`, `agent-loop`, and `triage-ticket`, whose config IS the
vendor it demonstrates.

The examples are also the scaffolder's templates. `npm create nola` (and
`nola init`) copies one of them — the first menu is `feature-extraction` (the
default), `function-calling`, `agent-loop`, `typescript-interop`,
`triage-ticket`, then the CLI's own `empty`; every other example sits behind
"More examples…" — from this directory in a checkout and from GitHub at the
matching release tag otherwise, adding the project name, the recommended
`.gitignore`, the chosen provider's config and a next-steps comment on top.
`feature-extraction`, `function-calling` and `typescript-interop` replay a
committed `nola.replay.jsonl` ledger instead of the mock, which is what makes
a scaffold's first run keyless; the ledger is keyed by the exact request, so
a change to their prompts or types (or to Nola's prompt composition) means
re-recording it.

Every ask is typed with the colon spelling, `` ask `…`: T `` — a call-intent
slot is written the same way, `` createTicket(`…`: T) ``, and a stored intent
adds the dots, `` ..`…`: T ``; `<T>` means the same thing. Context statements — a
bare template literal on its own line, optionally continued with values
(`` `Reasoning so far:` reasoning; ``) — appear where an example has
something to tell the model.

Each example is a standalone project built around one canonical
LLM-programming task (see its README for what it demonstrates).

| Example | Demonstrates |
|---|---|
| [feature-extraction](feature-extraction/) | Typed extraction as one `.tsi` file that is the program: a context statement, `const .message` / `const .role` bindings, two top-level asks, the second reading the first's answer — the default scaffold, on a replay ledger |
| [function-calling](function-calling/) | A top-level call intent as one `.tsi` file: the model fills `createTicket`'s arguments and the plain-TypeScript function next door runs with them — on a replay ledger |
| [typescript-interop](typescript-interop/) | An `infer function` in `person.tsi`, imported and awaited from plain `main.ts` — the library/app shape, on a replay ledger |
| [extract-person](extract-person/) | Typed extraction of an object — the hello world |
| [extract-resume](extract-resume/) | Nested arrays of objects, JSDoc schema descriptions |
| [extract-invoice](extract-invoice/) | Same-file type references, optional fields |
| [classify-message](classify-message/) | Closed label sets: union alias, string enum, inline union |
| [chain-of-thought](chain-of-thought/) | Two-step reasoning: a free-text ask carried into a typed ask by a context statement with a value (`` `Reasoning so far:` reasoning; ``) |
| [research-notes](research-notes/) | TS control flow orchestrating nola functions |
| [contextual-args](contextual-args/) | `.param` contextual parameters and the `system: { message }` config key |
| [cross-file-types](cross-file-types/) | A type imported from another file (a view of plain TypeScript), self-recursive; `schema.ts` prints its JSON Schema |
| [rich-types](rich-types/) | A discriminated union, a `Partial<…>` and a `Record<…>` as extraction and value types — shapes only the checker can derive |
| [constraints](constraints/) | JSDoc constraint tags (`@format`, `@minLength`, `@integer`, `@minItems`, …) as schema keywords the model reads and `validate` enforces — the correction turn lists every violation |
| [recursive-tree](recursive-tree/) | Self-recursive types: JSON Schema `$defs`/`$ref`, validated recursively |
| [file-ticket](file-ticket/) | Call intents: the model fills a function's arguments, sigil-less and hint forms |
| [agent-loop](agent-loop/) | An agent loop as one `.tsi` file: a top-level `while` whose `ask` is typed `Problem \| null`, a context statement inside the loop body (block-scoped like a `const`, seen once per ask, never piled up across passes), and one before the loop — `` `Problems recorded so far:` problems.map((p) => p.brief) `` continued by a second text line — re-read on every pass |
| [triage-ticket](triage-ticket/) | Ticket triage on typesafe.ai's Jev through `typesafe()`: literal unions and booleans as typed questions, as one `.tsi` file with a top-level `ask` — the one example whose committed config names a live vendor (`TYPESAFE_API_KEY`), so `npm create nola` skips the provider question for it and lists it on the first template menu |

`_playground/` is an internal debugging sandbox, not a maintained example.

The end-to-end test for the examples is `test/e2e/examples.test.ts`; that the
`.tsi` types flow into plain TS under `nola check` is asserted separately by
`test/e2e/example-types.test.ts`, which injects a typed consumer into a
throwaway copy of each example (both require `npm run build` first; the tests
run it themselves in `beforeAll`).
