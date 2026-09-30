# feature-extraction

Typed extraction as one `.tsi` file that is the whole program — the shape
`npm create nola` scaffolds by default. `src/main.tsi` opens with a context
statement every ask below it sees, holds the input in a `const .message`
binding, and asks at the top level: the first ask extracts a `Person`, the
second reads that answer through a `const .role` binding declared after it
and types the seniority as a literal union.

Answers replay from the committed `nola.replay.jsonl` ledger, so the first
run needs no API key. The ledger is keyed by the exact request: once you edit
the prompts or the types, switch `nola.config.ts` to a real model (its
comment shows how). A scaffold that chose a provider carries that provider's
config instead of the ledger, and a `.env.example` naming the key it reads.

```sh
npx nola-lang run src/main.tsi                     # replay ledger, no API key needed
# real model: edit nola.config.ts — `model: "nola"` (a key from `npx nola-lang key`) or openai("gpt-5-mini") (needs OPENAI_API_KEY)
```

When a script outgrows one file, move the asks into an `infer function` and
call it from plain TypeScript — `typescript-interop` is that shape.
