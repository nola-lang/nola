# tool-use

A tool-use ask as one `.tsi` file that is the whole program: `src/main.tsi`
offers the model two plain-TypeScript functions from `src/tools.ts` as tools,
written in brackets between the task and the type:

```tsi
const files = ask `the files on disc D that belong to a US visa application` [searchFiles, readFile]: string[];
```

The entries can also be a group: `import * as fileTools from "./tools.js"` and `[fileTools]` offers every function of the module as `fileTools.searchFiles`, `fileTools.readFile`; `[...fileTools]` offers them flat.

The model calls them as it needs — here it lists the `visa` folder, reads one
file to be sure, then answers. Nola runs each call in the process, hands the
result back, and asks again; the typed answer ends the loop and is what `ask`
yields. Parentheses would run a function once with model-filled arguments (a
call intent); brackets offer functions the model may call zero or more times.

The tool contract derives from each function's signature and JSDoc: the
parameters become the arguments the model fills, `@param` tags describe them.
A turn cap bounds the loop (`.withMaxTurns(n)`, or `ask.maxTurns` in
`nola.config.ts`, 10 by default), and a tool that throws ends the ask.

Answers replay from the committed `nola.replay.jsonl` ledger, turn by turn, so
the first run needs no API key. The ledger is keyed by the exact request —
the task, the tools and the transcript so far — so once you edit the prompt,
the tools or the types, switch `nola.config.ts` to a real model (its comment
shows how); `openai`, `anthropic`, `google` and `model: "nola"` support tool
use.

```sh
npx nola-lang run src/main.tsi                     # replay ledger, no API key needed
# real model: edit nola.config.ts — `model: "nola"` (a key from `npx nola-lang key`) or openai("gpt-5-mini") (needs OPENAI_API_KEY)
```
