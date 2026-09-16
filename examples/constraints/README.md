# constraints

JSDoc constraint tags on a type — `@format email`, `@minLength` / `@pattern`, `@integer` / `@minimum`, `@minItems` / `@uniqueItems` — become JSON Schema keywords the model reads and `validate` enforces. The mock's first reply breaks four of them; the correction turn carries every issue at once and the second reply is accepted. `main.ts` prints the accepted signup, two keywords read back from the schema, and the full issue list for the bad value.

```bash
npm start        # nola run src/main.ts
nola check
nola build
```
