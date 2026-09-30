# function-calling

A call intent as one `.tsi` file that is the whole program: `src/main.tsi`
asks the model to fill the arguments of `createTicket`, an ordinary async
function in the plain-TypeScript `src/tickets.ts` (imported with the NodeNext
`./tickets.js` specifier), and the call runs with them — `ask` yields the
ticket the function returned, not a promise. The customer's message is a
`const .message` binding the ask sees.

Answers replay from the committed `nola.replay.jsonl` ledger, so the first
run needs no API key. The ledger is keyed by the exact request: once you edit
the prompts or the types, switch `nola.config.ts` to a real model (its
comment shows how). A scaffold that chose a provider carries that provider's
config instead of the ledger, and a `.env.example` naming the key it reads.

```sh
npx nola-lang run src/main.tsi                     # replay ledger, no API key needed
# real model: edit nola.config.ts — `model: "nola"` (a key from `npx nola-lang key`) or openai("gpt-5-mini") (needs OPENAI_API_KEY)
```

`file-ticket` shows the same feature in the library shape — infer functions
in a `.tsi` file, called from plain TypeScript — in both call-intent
spellings.
