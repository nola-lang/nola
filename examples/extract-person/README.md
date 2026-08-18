# extract-person

Typed extraction of a nested object — the "hello world" of Nola.

The JSON Schema is derived from the `Person` interface at compile time and
the extraction is one typed expression — no runtime type-to-schema library,
no re-declared model class.

`src/format.ts` is plain TypeScript, value-imported from the `.tsi` with the
standard NodeNext `./format.js` specifier — existing TS code mixes into a nola
module with no extra setup.

```sh
npx nola run src/main.ts                      # mock provider (deterministic)
# real provider: edit nola.config.ts to openai({ model: "gpt-5-mini" }) (needs OPENAI_API_KEY)
```
