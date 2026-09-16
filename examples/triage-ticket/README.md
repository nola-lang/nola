# triage-ticket

Ticket triage on typesafe.ai's Jev — a model that is not a chat model. Its
API answers typed questions about a state (which option? is this true?) with
calibrated probabilities, so the `typesafe()` provider serves exactly the asks
whose output type it can express:

- **string literal unions** (`Department`) — one choice question, one option per value,
- **number literal unions** (`Priority`) — a choice question decoded back to the number,
- **booleans** (`urgent`, `refundRequested`) — a yes/no question, `true` at probability ≥ 0.5,
- a **flat object** of those (`Triage`) — one request, one question per property.

The JSDoc comment on each property becomes that question's instructions. Free
text, numbers, arrays and nested objects are not served: the provider fails
before the network with an error naming the property, so a mixed project pairs
it with a general model through `fallback([typesafe(), openai("gpt-5-mini")])`.

This example ships with `model: typesafe()` — scaffolding it skips the provider
question, and the first run needs `TYPESAFE_API_KEY` in `.env`.

```sh
npx nola-lang run src/main.ts                      # needs TYPESAFE_API_KEY
# offline: edit nola.config.ts to the mockProvider line in its comment
```
