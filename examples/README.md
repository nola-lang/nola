# Nola examples

Each example is a standalone npm workspace with the same layout: `src/*.tsi`
(the Nola source), `src/main.ts` (a plain TypeScript consumer run via `npx
nola run src/main.ts`), and a `nola.config.ts` that uses the deterministic
mock provider so the example runs without an API key (switch to a real
provider by editing the config — the comment inside shows how). The one
exception is `triage-ticket`, whose config IS the vendor it demonstrates.

Each example is a standalone project built around one canonical
LLM-programming task (see its README for what it demonstrates).

| Example | Demonstrates |
|---|---|
| [extract-person](extract-person/) | Typed extraction of an object — the hello world |
| [extract-resume](extract-resume/) | Nested arrays of objects, JSDoc schema descriptions |
| [extract-invoice](extract-invoice/) | Same-file type references, optional fields |
| [classify-message](classify-message/) | Closed label sets: union alias, string enum, inline union |
| [chain-of-thought](chain-of-thought/) | Two-step reasoning: a free-text ask interpolated into a typed ask |
| [research-notes](research-notes/) | TS control flow orchestrating nola functions |
| [contextual-args](contextual-args/) | `.param` contextual parameters and the `system: { message }` config key |
| [cross-file-types](cross-file-types/) | A type imported from another file (a view of plain TypeScript), self-recursive; `schema.ts` prints its JSON Schema |
| [rich-types](rich-types/) | A discriminated union, a `Partial<…>` and a `Record<…>` as extraction and value types — shapes only the checker can derive |
| [constraints](constraints/) | JSDoc constraint tags (`@format`, `@minLength`, `@integer`, `@minItems`, …) as schema keywords the model reads and `validate` enforces — the correction turn lists every violation |
| [recursive-tree](recursive-tree/) | Self-recursive types: JSON Schema `$defs`/`$ref`, validated recursively |
| [prompt-template](prompt-template/) | Prompt templates: `${.default}` in the marker, `${.type}` in the extractor |
| [file-ticket](file-ticket/) | Call intents: the model fills a function's arguments, sigil-less and hint forms |
| [triage-ticket](triage-ticket/) | Ticket triage on typesafe.ai's Jev through `typesafe()`: literal unions and booleans as typed questions — the one example whose committed config names a live vendor (`TYPESAFE_API_KEY`), so `npm create nola` skips the provider question for it |

`_playground/` is an internal debugging sandbox, not a maintained example.

The end-to-end test for the examples is `test/e2e/examples.test.ts`; that the
`.tsi` types flow into plain TS under `nola check` is asserted separately by
`test/e2e/example-types.test.ts`, which injects a typed consumer into a
throwaway copy of each example (both require `npm run build` first; the tests
run it themselves in `beforeAll`).
