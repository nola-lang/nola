# __NAME__

A [Nola](https://github.com/nola-lang/nola) project. Nola is a TypeScript
superset (`.tsi`) where `infer` functions and `ask` extractors turn prompts
into typed values.

```bash
npm install
npm start        # runs src/main.ts — works offline, no API key needed
npm run check    # type-checks the .tsi and .ts files together
npm run build    # compiles to plain JS + d.ts in dist/
```

The starter runs offline: `nola.config.ts` replays answers from the committed
`nola.replay.jsonl` ledger. The ledger is keyed by the exact prompt, so once
you edit `src/person.tsi` or add your own asks, switch the config to a real
provider (see the comment in `nola.config.ts`) and set `OPENAI_API_KEY`.
