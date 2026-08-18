# extract-resume

The industry-canonical structured-extraction demo — every LLM framework has a
resume example; this is Nola's.

The types are plain same-file interfaces (nested `Education[]` included,
JSDoc comments become schema descriptions) and the function is imported
directly — no schema DSL, no codegen step, no generated client directory, no
second language.

```sh
npx nola run src/main.ts                      # mock provider (deterministic)
# real provider: edit nola.config.ts to openai({ model: "gpt-5-mini" }) (needs OPENAI_API_KEY)
```
