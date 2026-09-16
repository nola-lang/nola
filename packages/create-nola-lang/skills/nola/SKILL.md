---
name: nola
description: Writing Nola .tsi files — a TypeScript superset with infer
  functions and ask extractors. Use when creating or editing .tsi files or
  nola.config.ts.
---

# Writing Nola

Nola is a TypeScript superset. `.tsi` files are NOT valid TypeScript — the
Nola toolchain lowers them to plain TS before tsc, bundlers, or Node see
them. Everything you know about TypeScript applies inside a `.tsi` file
EXCEPT the constructs below. A configured LLM resolves the new constructs at
run time.

## The constructs at a glance

```tsi
import type { Person } from "./types.js";

// An LLM-backed function: lowers to a plain function returning a lazy,
// thenable Intent<T>. `await`ing it (or `ask`) runs the inference.
infer function extractPerson(.text: string) {
  // `ask` resolves an intent the way `await` resolves a promise.
  const person = ask ..`Extract the person described in the text`<Person>;
  return person;
}
```

- `infer function name(...)` — declares a nola function. An optional
  backtick instruction goes between name and params:
  `` infer function name`instruction`(...) ``. `await` is legal in the body.
- `.name: T` parameters are CONTEXT parameters: their values are shown to
  the LLM. Plain (no dot) parameters are ordinary values the LLM never
  sees. `.` is only legal on infer-function parameters. Rule of thumb:
  ONE dot in (`.name` — the value flows into the model), TWO dots out
  (`` ..`prompt` `` — a value comes out of it).
- `` ask ..`prompt`<T> `` — an extractor: asks the LLM for a `T`.
  `${...}` interpolation works inside the backticks.
- `` ask fn`hint`(...) `` — or a plain call whose arguments contain an
  extractor — is a call intent (the LLM fills the extractor-shaped
  arguments, then the function runs). Only `` fn`hint`(...) `` carries
  instruction text.
- `ask with <modelName> <intent>` — routes one ask through a named model
  from `nola.config.ts`. The name must be a static identifier. When the
  platform serves inference (`model: nola.infer()`) any unconfigured
  name is legal — it is sent to the platform as a free-form inference profile.
- Prompt templates: inside ANY instruction backticks (marker, extractor,
  call hint) a hole that starts with a single dot — `${.member}` — reads
  the intent's prompt scope; a literal containing one REPLACES that
  intent's prompt block (`${.default}` is the built-in block, `${.next}`
  the rest of the prompt). Every other `${expr}` is a lexical value.
  See `references/syntax.md` → "Prompt templates".

## Where Nola diverges from TypeScript — hard rules

- `ask` is a reserved word in `.tsi` (still legal as a member/property
  name). `infer` is contextual: a keyword only directly before `function`.
- Identifiers starting with `__nola` are reserved. Never write them.
- Imports of `.tsi` files keep the literal extension:
  `import { f } from "./x.tsi"`. Imports of plain TS use NodeNext style:
  `import { g } from "./y.js"` (the `.js` extension, even though the source
  file is `.ts`).
- Every `export type` / `export interface` in a `.tsi` is ALSO a runtime
  value (`User.toJsonSchema()`, `User.validate(v)`, `User.parse(v)`,
  `User["~standard"]` — Standard Schema AND Standard JSON Schema, so
  `jsonSchema.input({ target: "openapi-3.0" })` works). Never declare a
  `const`/`function`/`class`/`enum`
  with an exported type's name (NOLA2011). `./x.tsi` with no `x.tsi` on disk
  is the VIEW of `x.ts`: the same module plus those values — import plain-TS
  types that way when you need their schema. Keep one basename per module.
- An extractor's `<T>` should be a named, JSON-shaped type. The schema comes
  from the RESOLVED type, so unions (a `kind` key makes them discriminated),
  `Partial<T>`, `extends`, `Record<string, T>` and types from packages all
  work; `Date` is revived to a real `Date`. `Map`/`Set`/`Promise`, functions
  and a generic used without arguments do not derive. A failed reply is
  corrected with EVERY validation issue at once.
- Constrain a member with JSDoc tags named like JSON Schema keywords —
  `/** @format email */`, `/** @integer @minimum 13 */`, `/** @minItems 1 */`,
  `@pattern`, `@minLength`, `@uniqueItems`, … — the model sees them and
  `validate` enforces them. A tag on the wrong kind of type is NOLA2012.
  See `references/syntax.md` → "Types as values".
- Raw extract/call intents are resolved with `ask`, never bare `await`
  (that throws NOLA3010). Infer-function RETURN values may be awaited.

## References

Read these before non-trivial work:

- `references/syntax.md` — full grammar and semantics of every construct
- `references/patterns.md` — worked examples (extraction, call intents)
- `references/config.md` — `nola.config.ts`, providers, project layout
- `references/pitfalls.md` — common errors (NOLA codes) and their fixes
