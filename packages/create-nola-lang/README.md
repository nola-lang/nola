# create-nola-lang

Scaffolds a new [Nola](https://github.com/nola-lang/nola) project:

```bash
npm create nola-lang my-app
cd my-app
npm install
npm start        # runs offline via a committed replay ledger - no API key needed
```

You get a typed extraction example (`src/person.tsi` + a plain-TS consumer),
`nola.config.ts`, tsconfig, and a recorded replay ledger so the first run
works without any API key. `nola init` (from the `nola-lang` package) lays
down the same starter.
