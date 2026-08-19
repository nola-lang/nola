# create-nola

Short alias of [`create-nola-lang`](https://www.npmjs.com/package/create-nola-lang):

```bash
npm create nola                                       # prompts for a name and a template
npm create nola my-app -- --template extract-resume   # non-interactive
npm create nola -- --add                              # add Nola to an existing project
```

`npm create nola` and `npm create nola-lang` run the same scaffolder with the
same flags — this package only forwards to `create-nola-lang`, which holds the
templates and the interactive flow (also reused by `nola init`).

Any package manager works the same way — the printed next steps follow the one
that ran it:

```bash
pnpm create nola my-app
yarn create nola my-app
bun create nola my-app
```

The scaffolded project installs and runs under npm, pnpm, yarn (classic and
berry, PnP included) and bun. Bun and Deno work as package managers, not as the
runtime: `bun run start` is fine (the `nola` bin runs on Node), `bun --bun` /
`bun src/main.ts` cannot load `.tsi` — Node ≥ 22 executes the code.

Nola is a TypeScript superset (`.tsi`) for writing LLM-backed functions:
[nola-lang/nola](https://github.com/nola-lang/nola).
