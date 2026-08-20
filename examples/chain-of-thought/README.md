# chain-of-thought

Two sequential asks in one nola function: the first is untyped (free-text
reasoning), the second interpolates that reasoning into its prompt with plain
`${}` and extracts the typed answer. The chain is ordinary TypeScript data
flow — a `const` from one ask used in the next — not a prompt-DSL construct.

Prompt-DSL frameworks usually express this as one prompt with a reasoning
preamble parsed out of the reply — a function there is a single prompt→parse
round trip, so the two steps cannot be separate calls. In Nola they are just
two statements, and the intermediate reasoning is a real value you can log,
test, or return alongside the answer.

```sh
npx nola run src/main.ts                      # mock provider (deterministic)
# real provider: edit nola.config.ts to openai({ model: "gpt-5-mini" }) (needs OPENAI_API_KEY)
```
