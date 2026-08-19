# nola-lang

The [Nola](https://github.com/nola-lang/nola) toolchain. Nola is a TypeScript
superset (`.tsi`) where `infer` functions and `ask` extractors turn prompts
into typed values, resolved by a configured LLM at run time.

Install as a **devDependency** — your app depends on
[`@nola-lang/runtime`](https://www.npmjs.com/package/@nola-lang/runtime) and
[`@nola-lang/providers`](https://www.npmjs.com/package/@nola-lang/providers)
instead (the scaffold sets all of this up):

```bash
npm create nola my-app          # or: npx nola init
```

## Commands

```
nola init [dir]                 scaffold a new Nola project
nola build [dir] [--out dist]   compile .tsi -> js + source maps + d.ts
nola run <entry>                run a .tsi/.ts entry with the loader + nola.config.ts
nola check [dir]                type-check .tsi and .ts together, positions mapped back
```

## Direct node execution (the tsx model)

```bash
node --import nola-lang/register src/main.tsi
```

The loader inlines source maps pointing at the on-disk `.tsi`, so VS Code
breakpoints bind directly in Nola source.

## Production builds

`nola build` output is self-contained: for app projects (the default) it
emits `dist/nola.config.js` — your bundled config — and wires every built
module to load it, so `node dist/<entry>.js` needs no loader and no manual
`nolaRuntime.configure()`. Library authors set `build: { target: "lib" }`
in nola.config.ts to skip that wiring; the consuming app configures the
process. Provider secrets come from the real environment in production —
`.env` files are a dev-time convenience.
