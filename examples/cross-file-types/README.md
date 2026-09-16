# cross-file-types

The view demo: `report.tsi` extracts a `Person` whose interface lives in
`models.ts` — the type crosses a file boundary, and it is self-recursive
(`manager?: Person`) so JSON Schema `$defs`/`$ref` are exercised end-to-end.
`schema.ts` imports the same interface through `./models.tsi` — no such file
on disk, so it is the *view* of `models.ts` — and prints its JSON Schema: no
generated files, one rule. Runs against the mock provider.

```bash
nola run src/main.ts
```
