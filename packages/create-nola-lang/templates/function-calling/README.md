# __NAME__

A [Nola](https://github.com/nola-lang/nola) project. Nola is a TypeScript
superset (`.tsi`) where `ask` turns a prompt into a typed value — or, as
here, into a function call: `src/main.tsi` asks the model to fill the
arguments of `createTicket`, an ordinary async function in `src/tickets.ts`,
and the call runs with them.

```bash
npm install
npm start        # runs src/main.tsi — __START_NOTE__
npm run check    # type-checks the .tsi and .ts files together
npm run build    # compiles the .tsi to plain JS in dist/
npx nola-lang console   # traces every ask in your browser (it prints the config line to add)
```

__PROVIDER_NOTE__

When a script outgrows one file, move the asks into an `infer function`
and call it from plain TypeScript — `npm create nola -- --template typescript-interop`
lays down that shape.
