# chain-of-thought

Two sequential asks in one nola function: the first is untyped (free-text
reasoning), the second extracts the typed answer. Because every ask in an
invocation shares the accumulating context, the model answers the second ask
with its own reasoning in view — chain-of-thought as a language property, not
a prompt template.

Prompt-DSL frameworks usually express this as one prompt with a reasoning
preamble parsed out of the reply — a function there is a single prompt→parse
round trip, so the two steps cannot be separate calls sharing context. In Nola
they are just two statements.

```sh
npx nola run src/main.ts                      # mock provider (deterministic)
# real provider: edit nola.config.ts to openai({ model: "gpt-5-mini" }) (needs OPENAI_API_KEY)
```
