# create-nola-lang

Scaffolds a new [Nola](https://github.com/nola-lang/nola) project:

```bash
npm create nola my-app          # or: npm create nola-lang my-app
cd my-app
npm install
npm start        # runs offline via a committed replay ledger - no API key needed
```

Interactively the flow asks for a name (Enter keeps the default), a template,
an inference provider (Nola first — 25 free runs, no account or provider key —
then OpenAI, Anthropic, Gemini, or skip), whether to set up your editor and
coding agents (yes opens one list: VS Code, preselected, writes `.vscode/`
with a debug config + the extension recommendation; coding-agent skills,
Claude Code preselected), and — once the files are written, when an editor
was chosen — whether to install dependencies and open the project in VS Code
right away (on `src/main.ts`, whose opening comment lists the next steps:
F5 to run, a breakpoint to debug, the recommended extension).

You get a typed extraction example (`src/person.tsi` + a plain-TS consumer),
`nola.config.ts`, tsconfig, and a recorded replay ledger so the first run
works without any API key. `npm create nola` is a short alias of this package
(`create-nola`); `nola init` (from the `nola-lang` package) lays
down the same starter.
