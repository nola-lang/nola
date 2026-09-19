# create-nola-lang

Scaffolds a new [Nola](https://github.com/nola-lang/nola) project:

```bash
npm create nola my-app          # or: npm create nola-lang my-app
cd my-app
npm install
npm start        # runs offline via a committed replay ledger - no API key needed
```

Interactively the flow asks for a name (Enter keeps the default), a template,
an inference provider (`nola: dev` first — 25 free hosted runs, no API key required, suited for dev experiments —
then OpenAI, Anthropic, Gemini, typesafe.ai — bracketed with the caveat that
it serves literal unions and booleans only — or skip), and — once the files are
written, unless `--ide none` — whether to install dependencies and open the
project in VS Code right away (just the install when VS Code's `code` command
is not on PATH; on the entry file — `src/main.tsi`, or
`src/main.ts` for `typescript-interop` — whose opening comment lists the next
steps: F5 to run, a breakpoint to debug, the recommended extension). The editor
setup (`.vscode/` with a debug config + the extension recommendation) and the
coding-agent skill (`.agents/skills/nola/`, with `.claude/skills/nola` a
symlink to it for Claude Code) are written without a question; `--ide none` and
`--agents none` opt out, `--agents claude,universal,agents-md` adds `AGENTS.md`.

You get one template per feature — `feature-extraction` (the default) is one
`src/main.tsi` with a top-level `ask`, `function-calling` the same with a call
intent over an async function in `src/tickets.ts`, `typescript-interop` is
`src/person.tsi` plus a plain-TS consumer — with `nola.config.ts`, tsconfig,
and a recorded replay ledger so the first run works without any API key. `npm create nola`
is a short alias of this package (`create-nola`); `nola init` (from the
`nola-lang` package) lays down the same templates.
