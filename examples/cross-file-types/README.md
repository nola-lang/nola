# cross-file-types

The companion-module demo: `report.tsi` extracts a `Person` whose interface
lives in `models.ts` — the type crosses a file boundary, and it is
self-recursive (`manager?: Person`) so JSON Schema `$defs`/`$ref` are exercised
end-to-end. Runs against the mock provider.

```bash
nola run src/main.ts
```
