# Nola examples

Each example is a standalone npm workspace with the same layout: `src/*.tsi`
(the Nola source), `src/main.ts` (a plain TypeScript consumer run via `npx
nola run src/main.ts`), and a `nola.config.ts` that uses the deterministic
mock provider so the example runs without an API key (switch to a real
provider by editing the config — the comment inside shows how).

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
| [cross-file-types](cross-file-types/) | A type imported from another file (companion module), self-recursive |
| [recursive-tree](recursive-tree/) | Self-recursive types: JSON Schema `$defs`/`$ref`, validated recursively |
| [prompt-template](prompt-template/) | Prompt templates: `${.default}` in the marker, `${.type}` in the extractor |

`_playground/` is an internal debugging sandbox, not a maintained example.

The end-to-end test for the examples is `test/e2e/examples.test.ts`; that the
`.tsi` types flow into plain TS under `nola check` is asserted separately by
`test/e2e/example-types.test.ts`, which injects a typed consumer into a
throwaway copy of each example (both require `npm run build` first; the tests
run it themselves in `beforeAll`).
