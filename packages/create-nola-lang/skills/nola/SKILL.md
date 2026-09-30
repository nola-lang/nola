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
  const person = ask `Extract the person described in the text`: Person;
  return person;
}
```

- `infer function name(...)` — declares a nola function. Any bare template
  literal on its own line in the body is a CONTEXT STATEMENT: text every
  later `ask` in the invocation sees, read at each ask. It may continue with
  values: `` `Page` oncall `when the ticket is an outage.` `` (a name, a call
  or a bracketed literal; anything else in parentheses — but `await`, `ask`
  and `this` cannot be values: assign them to a local first). Several are
  legal, anywhere in the body; one before a loop shows the current state on
  every pass. Visibility is lexical, like a `const`: a statement inside a
  block reaches only the asks inside those braces, and statements never
  accumulate across loop passes — each ask sees every statement visible at
  its position exactly once, rendered at that ask. `await` is legal in the
  body.
- `.name: T` parameters are CONTEXT parameters: their values are shown to
  the LLM. Plain (no dot) parameters are ordinary values the LLM never
  sees. `.` is only legal on infer-function parameters. Rule of thumb:
  one dot marks a value flowing INTO the model (`.name`); a template after
  `ask` is a value coming OUT.
- `` ask `prompt`: T `` — an extractor: asks the LLM for a `T`. The colon
  is glued to the closing backtick; `` ask `prompt`<T> `` is the same
  construct (write `: T` unless a page shows otherwise).
  `${...}` interpolation works inside the backticks. The `..` is implied
  directly after `ask` and in a call's argument list — a typed template
  that starts an argument, or a value nested in a plain object/array
  literal there, is an extractor: `` createTicket(`a short title`: string, 2) ``.
  Anywhere else — a stored intent, a ternary, a spread, `new` — spell it
  `` ..`prompt`: T `` (a typed `` `x`<T> `` elsewhere is NOLA2014, a
  `` `x`: T `` a syntax error); `` ask ..`prompt` `` and `` fn(..`x`: T) ``
  are still legal.
- `` ask fn`hint`(...) `` — or a plain call whose arguments contain an
  extractor — is a call intent (the LLM fills the extractor-shaped
  arguments, then the function runs). Only `` fn`hint`(...) `` carries
  instruction text.
- `ask with <modelName> <intent>` — routes one ask through a named model
  from `nola.config.ts`. The name must be a static identifier. When the
  platform serves inference (`model: "nola"`) any unconfigured
  name is legal — it is sent to the platform as a free-form inference profile.
- Values in an instruction — two spellings, one rule: `.name` (a contextual
  parameter or `const .name` binding) is DATA, rendered as an `<input
  name>` block the system turn marks as data; a value after text in a
  context statement (`` `Page` oncall ``) or a `${expr}` hole in ANY
  instruction backticks is part of the developer's words, spliced where it
  stands (a string verbatim, a function its name, a call intent its callee
  and arguments, anything else JSON) — the model FOLLOWS it, so interpolate
  only text the developer controls (a team name, a count, a date) and put
  anything a user or a document supplied in `.name`. A context statement is
  read at EACH ask that sees it (module or body alike); an extractor's or
  hint's text when the ask runs. A Nola construct (`ask`, `..`) inside a
  context statement's value or hole, or in a call hint's hole, is NOLA2010
  (written bare right after the text, NOLA1020); a call intent is a legal
  value (a HINTED `` fn`hint`(…) `` one only in parentheses or a `${}` hole —
  bare it is no call intent, and its extractor argument is NOLA2010). There
  is no `${.member}` prompt scope (a dot cannot start a hole's expression).
  See `references/syntax.md` → "Context statements" and "Values in an
  instruction".
- The prompt itself is the developer's words in four tags — `<context
  function|module>` with `<input name>` blocks, then `<task>` (`<task
  call="fn">` for a call intent); the schema rides structured output, never
  the prompt; `system.message` REPLACES the default system text. See
  `references/syntax.md` → "The prompt".

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
- An extractor's type should be a named, JSON-shaped type. The schema comes
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
