# prompt-template

Demonstrates prompt templates: a `${.member}` hole in an instruction turns
that instruction into a template for the intent's prompt block. The
infer-function marker keeps the built-in CONTEXT block (`${.default}`) and
adds rules after it; the extractor states its target type (`${.type}`)
inside its own TASK block. Everything after the dot is plain TypeScript.

```bash
nola run src/main.ts
```
