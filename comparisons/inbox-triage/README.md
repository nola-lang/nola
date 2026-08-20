# Inbox Triage, Six Ways

The same task implemented in **[Nola](https://github.com/nola-lang/nola)**,
**[BAML](https://github.com/BoundaryML/baml)**,
**[LangChain.js](https://github.com/langchain-ai/langchainjs)**,
**[Ax](https://axllm.dev)**,
**[Vercel AI SDK](https://github.com/vercel/ai)**, and the
**[plain OpenAI SDK](https://github.com/openai/openai-node)**:

> A raw customer email arrives. Classify it (**order** or **quote request**), extract a typed
> `OrderRequest` from the free text — nested customer/address/line-item objects and a real
> `Date` field — and route it to the right handler, with the quote branch driven by
> LLM function calling.

Each folder is a complete, installable project. The domain types (`types.ts`), the handlers,
and the two sample emails are identical across all six — everything else is what each stack
makes you write to get from "email text" to "typed object handed to a plain function."

## The numbers

Counted from the files in this repo (non-blank lines, hand-written files only —
`package.json` and `tsconfig.json` excluded everywhere):

| | **Nola** | **BAML** | **LangChain.js** | **Ax** | **Vercel AI** | **OpenAI SDK** |
|---|---|---|---|---|---|---|
| Lines you write | **87**¹ | 112 | 118 | **87** | 114 | 131 |
| Files you write | 5 | 5 | 4 | 4 | 4 | 4 |
| Times the domain model is declared | **1** | 1² | 2 | 2 | 2 | 2 |
| Hand-written wire schema | **none** | `.baml` classes | zod | signature string | zod | zod, `.nullable()`³ |
| `needBy` arrives as a real `Date` | **yes** | no | no | **yes** | no | no |
| Codegen steps / generated files | **0 / 0** | 1 / 14 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| A rename in `types.ts` propagates | **yes** | n/a² | no | no | no | no |
| Compile error when the model drifts | **yes** | no | no | no | no | no |
| Editor support where the schema lives | **yes** | yes | yes | **no**⁴ | yes | yes |
| First run with no API key | **yes** | no | no | no | no | no |
| Breakpoint inside the LLM function | **yes** | no | n/a | n/a | n/a | n/a |

¹ 30 of Nola's 87 lines are the offline mock fixture in `nola.config.ts` that lets the demo
run with zero API keys. With a real provider that config is ~8 lines — total ≈ 65.

² BAML avoids a second declaration only by inverting ownership: the domain model moves *into*
`baml_src/`, and the rest of the app imports the generated `baml_client/types`. There is no
`types.ts` left to rename.

³ OpenAI's strict Structured Outputs requires every key to appear in `required`, so optional
fields must be spelled `.nullable()` and mapped back to `undefined` by hand — a tax the other
zod-based stacks don't pay.

⁴ Ax's model lives inside a signature *string*. Editors have nothing to complete, check, or
jump to inside it; a typo there is a runtime error.

## Run them

**Nola** — no API key needed:

```sh
cd nola && npm install && npm start
```

> Installs `@nola-lang/*` and `nola-lang` from npm (currently `0.1.3`) — no checkout of the
> Nola monorepo needed, even though this folder lives inside it. The demo runs against the
> mock provider in `nola.config.ts`, so the first run works offline.

**Everything else** — each needs `OPENAI_API_KEY`:

```sh
cd baml       && npm install && npm start   # runs baml-cli generate first
cd langchain  && npm install && npm start
cd ax         && npm install && npm start
cd vercel-ai  && npm install && npm start
cd openai-sdk && npm install && npm start
```

Expected output (identical across stacks):

```
ORDER PLACED: 16 units for Dana Reyes → Oakland 94607 by Wed Sep 30 2026 [rush]
QUOTE QUEUED for Priya Sharma: quote for ~200 M8 temperature sensor bundles
```

## What to look at

**`nola/src/triage.tsi`** — the whole LLM seam is 13 lines. The extraction is one expression
against the `OrderRequest` interface the codebase already has; the JSON schema (nested
objects, the union, the `Date`) is derived at compile time, and `needBy` arrives revived. The
quote branch is a call intent: the LLM fills `requestQuote`'s arguments, Nola calls it.

**`ax/src/signatures.ts`** — the closest competitor on ergonomics, and the most interesting
one. Ax's signature grammar is genuinely terse, it infers result types end-to-end, and it
revives `datetime` into a real `Date` — it ties Nola on line count. The catch is *where* the
model lives: a template string. Your editor can't complete a field name in it, `tsc` can't
tell you it drifted from `types.ts`, and the assignment onto the domain type is the only
place the two could ever meet.

**`baml/baml_src/triage.baml`** — the model re-declared in a second language, prompts written
by hand (`{{ ctx.output_format }}` included), and a codegen step whose 14 generated files the
app imports. Renaming a field means editing `.baml`, regenerating, and fixing the fallout.

**`langchain/src/schemas.ts`** and **`vercel-ai/src/schemas.ts`** — the zod mirror. Every
domain field exists twice; the date is revived by hand; drift the compiler can't see (an
added optional field, a changed description) is silent until runtime.

**`openai-sdk/src/main.ts`** — the floor. No framework, just `responses.parse` with
`zodTextFormat` and a `zodResponsesFunction` tool. It's honest and dependency-light, and it
is also the longest of the six: strict mode's `.nullable()` rule means the bridge back to the
domain type has to unpick nulls field by field.

## Try the editor story

Open this repo in VS Code with the Nola VS Code extension (`nola.nola-vscode`) installed:

1. **F5** runs "Nola: inbox-triage demo" under the debugger.
2. Set a breakpoint on the `const order = ask ...` line in `triage.tsi` — it binds, and
   hovering `.email` while paused shows the live value.
3. **F11** from `triageEmail(orderEmail)` in `main.ts` steps *into* the `.tsi` body.
4. F2-rename `needBy` in `types.ts` — the wire schema follows; nothing else to touch. Try the
   same rename in the other five folders and count what breaks silently.
5. Delete the `priority` field from `OrderRequest` — `nola check` (and the editor) flag the
   handler that still uses it before anything runs.

## Fairness notes

- **All six were verified.** The Nola one runs end-to-end offline and `nola check` is clean;
  the other five type-check clean (`tsc --noEmit`) and need only an `OPENAI_API_KEY` to run.
  The Ax signatures were additionally verified to parse by constructing them without a key.
- **Ax comes out well here, and that's the finding.** An earlier draft of the Ax version did
  more manual mapping than Ax actually requires; it was simplified after checking what Ax
  infers. If a stack looks worse than it should, that's a bug in this repo — file it.
- **Three DX wrinkles worth knowing**, all hit while writing this: in the Vercel AI SDK,
  `toolCalls[0].input` is typed `unknown` — you need `staticToolCalls` for typed arguments.
  In the OpenAI SDK, strict Structured Outputs rejects `.optional()` outright. And installing
  `@ax-llm/ax` runs a postinstall that writes 17 `SKILL.md` files into your project's
  `.claude/skills/` — they are gitignored here.
- **Scope.** BAML's playground and inline tests, LangChain's ecosystem, the AI SDK's
  streaming and React bindings, and Ax's optimizers are all real advantages this comparison
  doesn't measure. It measures exactly one thing: what it costs to get **typed extraction +
  function calling** into an existing TypeScript codebase.
- If you can make any non-Nola implementation shorter or more idiomatic, PRs are welcome —
  the structural rows (declaration count, drift detection, codegen) are the point, not golf.
