# Nola Comparisons

Side-by-side implementations of the same task in **[Nola](https://github.com/nola-lang/nola)**
and its closest alternatives. Every comparison is a folder holding one complete, installable
project per stack — same domain types, same inputs, same expected output — so the differences
you see are what each stack actually makes you write, not prose claims.

| Comparison | Task | Stacks |
|---|---|---|
| [inbox-triage](./inbox-triage) | Classify a customer email, extract a typed `OrderRequest` (nested objects + `Date`), route it via LLM function calling | Nola · BAML · LangChain.js · Ax · Vercel AI SDK · OpenAI SDK |

Each comparison's README carries its own numbers table (lines of code, files, schema
duplication, codegen steps) counted from the files in this repo, plus fairness notes. If you
can make a non-Nola implementation shorter or more idiomatic, PRs are welcome — the
structural rows are the point, not golf.

## Layout convention

```
<comparison-name>/
├── README.md      the scenario, the numbers, how to run
├── nola/
├── baml/
├── langchain/
├── ax/
├── vercel-ai/
└── openai-sdk/    (stacks may vary per comparison)

presentation/      Figma-editable SVG slides of the comparison tables
```

## Slides

[`presentation/`](./presentation) holds the same tables as 1920×1080 SVG slides that import
into Figma as editable text layers — see its README for the import steps.
