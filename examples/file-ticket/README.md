# file-ticket

Call intents: the model fills a function's arguments, then the function runs
with them. `createTicket(title, priority)` in `ticket-store.ts` is plain
TypeScript; `tickets.tsi` makes calling it an intent in both spellings —
sigil-less (`ask createTicket(..\`title\`<string>, 2)`, one extractor slot
plus a plain argument) and the hint form (`` createTicket`instruction`(...) ``,
two slots, one provider call). `ask` yields the callee's settled value, a
string, not a `Promise<string>`.

```sh
npx nola-lang run src/main.ts                      # mock provider (deterministic)
# real provider: edit nola.config.ts to openai({ model: "gpt-5-mini" }) (needs OPENAI_API_KEY)
```
