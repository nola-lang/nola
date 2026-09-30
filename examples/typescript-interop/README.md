# typescript-interop

The shape a Nola library or application takes: `src/person.tsi` holds an
`infer function` (`extractPerson`, with a `.message` contextual parameter and
one typed ask), and the plain-TypeScript `src/main.ts` imports it with the
literal `./person.tsi` specifier and awaits it like any async function. The
result is typed across the boundary, and `nola check` type-checks both files
together.

Answers replay from the committed `nola.replay.jsonl` ledger, so the first
run needs no API key. The ledger is keyed by the exact request: once you edit
the prompt or the type, switch `nola.config.ts` to a real model (its comment
shows how). A scaffold that chose a provider carries that provider's config
instead of the ledger, and a `.env.example` naming the key it reads.

```sh
npx nola-lang run src/main.ts                      # replay ledger, no API key needed
# real model: edit nola.config.ts — `model: "nola"` (a key from `npx nola-lang key`) or openai("gpt-5-mini") (needs OPENAI_API_KEY)
```

`extract-person` is the same program with a plain-TypeScript helper
(`format.ts`) mixed in, on the mock provider.
