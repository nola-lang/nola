# extract-invoice

Realistic business-document extraction: an array of nested line items, an
optional field (`dueDate?`), a type referencing another same-file type
(`Invoice` → `LineItem[]`), and JSDoc comments that become schema descriptions.

The schema is a checked TypeScript interface and the extraction is one typed
expression — no prose contract, no agent session, nothing to keep in sync with
the type.

```sh
npx nola run src/main.ts                      # mock provider (deterministic)
# real provider: edit nola.config.ts to openai({ model: "gpt-5-mini" }) (needs OPENAI_API_KEY)
```
