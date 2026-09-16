# rich-types

A discriminated union (`Refund | Chargeback`), a `Partial<…>` and a `Record<string, number>` used as extraction and value types. The checker-backed derivation (emit 15) resolves each to its JSON Schema; `main.ts` prints the classified event, the number of union branches, the (empty) required list of the partial, and a failed record validation.

```bash
npm start        # nola run src/main.ts
nola check
nola build
```
