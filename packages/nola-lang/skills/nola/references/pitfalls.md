# Common Nola errors and their fixes

Diagnostic codes are stable: `NOLA1xxx` parse, `NOLA2xxx` compile, `NOLA3xxx`
run time.

## NOLA1009 — `ask with` needs a static provider name

> expected a provider name after `ask with` — for a dynamic provider use
> `.withProvider(...)` on the intent.

The alias after `with` must be a bare identifier naming a key of the
`providers` map in `nola.config.ts`. A string literal, a variable expression or
a parenthesized expression will not parse.

```tsi
export infer function summarize(.text: string, useFast: boolean) {
  // WRONG
  const a = ask with "fast" ..`a rough summary`<string>;
  const b = ask with providers.fast ..`a rough summary`<string>;

  // RIGHT — name it in nola.config.ts, then use that name
  const c = ask with fast ..`a rough summary`<string>;

  // RIGHT — dynamic choice
  const d = ask (..`a rough summary`<string>).withProvider(useFast ? "fast" : "careful");

  return { a, b, c, d };
}
```

```ts
// nola.config.ts
export default defineConfig({
  providers: {
    default: openai({ model: "gpt-5-mini" }),
    fast: openai({ model: "gpt-5-nano" }),
  },
});
```

## NOLA1010 — `.` on a non-infer function

> `.` context parameters are only allowed on infer function parameters.

```tsi
// WRONG — a plain function has no inference context to put the value in
function summarize(.text: string) {
  return text.slice(0, 10);
}

// RIGHT
export infer function summarize(.text: string) {
  return ask ..`a one-sentence summary`<string>;
}
```

If the function is genuinely plain TypeScript, drop the `.`; the parameter is
an ordinary argument.

## NOLA2001 — `ask` outside an infer function body

> `ask` is only allowed directly inside an infer function body.

`ask` is not legal at module level, and not inside a nested closure — not even
one written inside an infer function.

```tsi
// WRONG
const kind = ask ..`the kind`<string>;                  // module level

export infer function f(.t: string) {
  const g = () => ask ..`the kind`<string>;             // nested closure
  return g();
}

// RIGHT — ask directly in the body; from plain TS, await the infer function
export infer function f(.t: string) {
  return ask ..`the kind`<string>;
}
```

Constructing an extractor outside a body is fine — only resolving it is
restricted:

```tsi
export const nameIntent = ..`the user's full name`<string>;   // legal, inert
```

## NOLA2002 — a type the compiler cannot turn into a schema

> unsupported type for intent schema: …

An extractor's `<T>` must describe a JSON-shaped value: strings, numbers,
booleans, `Date`, arrays, plain object/interface/type-alias shapes,
string-literal unions, string enums, and references to those (same-file or
imported). Ambient lib types like `Map`, `Set`, `RegExp`, functions and
generics are not derivable.

```tsi
export infer function tally(.doc: string) {
  // WRONG
  const wrong = ask ..`counts per label`<Map<string, number>>;

  // RIGHT — a JSON-shaped type; convert afterwards in plain TS
  const counts = ask ..`counts per label`<{ label: string; count: number }[]>;
  const asMap = new Map(counts.map((c) => [c.label, c.count]));
  return asMap;
}
```

Always give an extractor a concrete `<T>` in an expression position. An
extractor is a value-producing expression; it is not a statement, a type, or a
declaration.

## NOLA2008 — an underivable `.` contextual parameter type

> contextual parameter 'm' has a type that cannot be derived for inference:
> unsupported type for intent schema: Map<string, number>. Set
> compiler.underivableContextType to "prune" or "omit" in nola.config.ts to
> allow it.

The same derivability rules apply to contextual parameters, because their
values are serialized into the prompt.

```tsi
// WRONG
export infer function topLabel(.index: Map<string, number>) {
  return ask ..`the label with the highest count`<string>;
}

// RIGHT — pass a JSON-shaped view as the contextual parameter
export infer function topLabel(.index: { label: string; count: number }[]) {
  return ask ..`the label with the highest count`<string>;
}

// RIGHT — keep the exotic value, but as a PLAIN parameter (the LLM never
// sees its value, so nothing needs deriving)
export infer function topLabel(.summary: string, index: Map<string, number>) {
  const label = ask ..`the label with the highest count`<string>;
  return { label, count: index.get(label) ?? 0 };
}
```

If you must keep an underivable member on a contextual type, relax the policy
in `nola.config.ts` — `"prune"` drops just the underivable members and keeps
the rest of the type; `"omit"` drops the whole type silently:

```ts
export default defineConfig({
  providers: { default: openai({ model: "gpt-5-mini" }) },
  compiler: { underivableContextType: "prune" },   // default is "error"
});
```

Keep that value a literal — the editor reads it statically and never executes
your config.

## NOLA2004 — a call-intent slot with no `<T>`

> an extractor used as a call-intent argument must have an explicit `<T>`.

```tsi
declare function createTicket(title: string, priority: number): Promise<string>;

export infer function fileTicket(.request: string) {
  // WRONG — the slot has no type
  const wrong = ask createTicket(..`a short ticket title`, 2);

  // RIGHT
  const id = ask createTicket(..`a short ticket title`<string>, 2);
  return id;
}
```

## NOLA3010 — bare `await` on a raw extract or call intent

> extract/call intents carry no construction scope — only `ask` supplies their
> frame.

A raw extractor or call intent has no context of its own; it borrows the frame
of the `ask` that resolves it. Awaiting one directly (typically from plain TS,
or after storing it in a variable) throws at run time.

```ts
// WRONG — nothing supplies the inference context
import { nameIntent } from "./person.tsi";
const name = await nameIntent;
```

```tsi
// RIGHT — resolve it with `ask` inside an infer function
import { nameIntent } from "./person.tsi";

export infer function whoIsIt(.text: string) {
  return ask nameIntent;
}
```

```ts
// RIGHT — from plain TS, await the INFER FUNCTION's result (that is an
// Intent, which does open its own invocation)
import { whoIsIt } from "./person.tsi";

const name = await whoIsIt("Alice Smith, 32, works at Acme Corp.");
```

## Import mistakes

- `.tsi` imports keep the LITERAL extension:

```ts
import { extractPerson } from "./person.tsi";     // RIGHT
import { extractPerson } from "./person";         // WRONG — unresolved
import { extractPerson } from "./person.js";      // WRONG — no such file
```

- Plain TypeScript imports use the NodeNext `.js` specifier, even though the
  file on disk is `.ts`:

```ts
import { createTicket } from "./tickets.js";      // RIGHT
import { createTicket } from "./tickets.ts";      // WRONG — TS5097
import { createTicket } from "./tickets";         // WRONG — TS2835
```

- Never import a `*.nola.*` module. Those are internal companion modules the
  compiler generates for cross-file types; only generated code imports them,
  and a hand-written file with such a name is NOLA2006.

```ts
import { Person } from "./models.nola.js";        // WRONG — internal
import type { Person } from "./models.js";        // RIGHT
```

## Never write generated-code names

`__nola` and any identifier starting with `__nola` are reserved in `.tsi`.
`__nola.ask(...)`, `__nola.intents.ExtractIntent(...)`, `__nola.types.string()`
and `__nola_file_ctx()` are what the compiler EMITS — they are not an API you
call, and writing them by hand is an error.

```tsi
export infer function read(.doc: string) {
  // WRONG — this is emitted code, not a user-facing API
  const wrong = await __nola.ask(
    __nola.intents.ExtractIntent({ instruction: "the value", type: __nola.types.string(), loc: "1:1" }),
    __frame,
  );

  // RIGHT
  const v = ask ..`the value`<string>;
  return v;
}
```

## NOLA2009 — `${.member}` outside a Nola instruction

`${.x}` is prompt-scope access and only means something inside an
infer-function marker, an extractor's backticks, or a call-intent hint. In a
plain template literal it is an error — use a lexical value there.

## NOLA2010 — a Nola construct inside a marker / call-hint hole

Marker and call-hint literals are re-emitted from source, so `..`, call
intents and `ask` cannot appear in their holes. Compute the value first and
interpolate the result, or move the ask into the function body.

## NOLA3014 — a prompt template rendered nothing (or threw)

A `${.member}` template must produce text. An empty result usually means the
template only read members that were undefined; a throw is a bug in the
template's own JS. Fixed at the template — there is no retry.

## Other things that will not parse

- `async infer function f(...)` — an infer function is never `async` in source;
  `await` is already legal in its body.
- `export default infer function f(...)` — export by name instead.
- `infer` on a method, arrow function or function expression — top-level
  function declarations only.
- `fn(..)` — the bare derive-all call form is reserved (NOLA1004).
