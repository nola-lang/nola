# chain-of-thought

Two sequential asks in one nola function: the first is untyped (free-text
reasoning), the second extracts the typed answer with that reasoning in view.
What carries it across is a context statement — `` `Reasoning so far:`
reasoning; `` — text followed by a value, read when the second ask runs. The
chain is ordinary TypeScript data flow — a `const` from one ask shown to the
next — not a prompt-DSL construct.

Prompt-DSL frameworks usually express this as one prompt with a reasoning
preamble parsed out of the reply — a function there is a single prompt→parse
round trip, so the two steps cannot be separate calls. In Nola they are just
two statements, and the intermediate reasoning is a real value you can log,
test, or return alongside the answer.

```sh
npx nola-lang run src/main.ts                      # mock provider (deterministic)
# real provider: edit nola.config.ts to openai({ model: "gpt-5-mini" }) (needs OPENAI_API_KEY)
```
