# __NAME__

A [Nola](https://github.com/nola-lang/nola) project. Nola is a TypeScript
superset (`.tsi`) where `infer` functions and `ask` extractors turn prompts
into typed values.

```bash
npm install
npm start        # runs src/main.ts — __START_NOTE__
npm run check    # type-checks the .tsi and .ts files together
npm run build    # compiles to plain JS + d.ts in dist/
npx nola-lang console   # traces every ask in your browser (it prints the config line to add)
```

__PROVIDER_NOTE__
