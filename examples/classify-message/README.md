# classify-message

Classification against closed label sets, in all three native TS forms:

- a **string-literal union alias** (`type Category = "billing" | "refund" | ...`),
- a **string enum** (`enum Sentiment { Positive = "positive", ... }`) — the enum
  is a runtime value too, so consumers compare with `Sentiment.Negative`,
- an **inline union** (`<"yes" | "no">`) mapped to a boolean in plain TS.

Each lowers to a JSON Schema `enum`, is enforced by the provider's structured
outputs *and* re-validated by the runtime (a wrong label triggers a retry that
lists the allowed values).

No separate schema DSL and no generated mirror types: the label set is the
TypeScript type you already have. Per-label descriptions (a hint attached to
each variant) have no Nola equivalent yet — a planned follow-up.

```sh
npx nola run src/main.ts                      # mock provider (deterministic)
# real provider: edit nola.config.ts to openai({ model: "gpt-5-mini" }) (needs OPENAI_API_KEY)
```
