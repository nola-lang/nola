# research-notes

Multi-hop research: a plain TypeScript `for` loop orchestrates two nola
functions — `nextQuery` decides what to search for, plain code does the
retrieval, and `conclude` produces a typed answer from the accumulated notes.
Each invocation is seeded with the question and the notes gathered so far.

The classic multi-hop question ("David Gregory's castle") needs no
framework of composable modules to express this loop: the orchestrator is the
host language itself, and the LLM boundary is two ordinary functions.

```sh
npx nola run src/main.ts                      # mock provider (deterministic)
# real provider: edit nola.config.ts to openai({ model: "gpt-5-mini" }) (needs OPENAI_API_KEY)
```
