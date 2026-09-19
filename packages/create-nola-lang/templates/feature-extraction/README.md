# __NAME__

A [Nola](https://github.com/nola-lang/nola) project. Nola is a TypeScript
superset (`.tsi`) where `ask` turns a prompt into a typed value. This
project is one file, `src/main.tsi`: a first-line instruction, `const .x`
context bindings, and `ask` at the top level — the file is the program.

```bash
npm install
npm start        # runs src/main.tsi — __START_NOTE__
npm run check    # type-checks the .tsi file
npm run build    # compiles to plain JS in dist/
npx nola-lang console   # traces every ask in your browser (it prints the config line to add)
```

__PROVIDER_NOTE__

When a script outgrows one file, move the asks into an `infer function`
and call it from plain TypeScript — `npm create nola -- --template typescript-interop`
lays down that shape.
