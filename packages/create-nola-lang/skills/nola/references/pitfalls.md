# Common Nola errors and their fixes

Diagnostic codes are stable: `NOLA1xxx` parse, `NOLA2xxx` compile, `NOLA3xxx`
run time.

## NOLA1009 — `ask with` needs a static provider name

> expected a provider name after `ask with` — for a dynamic provider use
> `.withModel(...)` on the intent.

The alias after `with` must be a bare identifier naming a key of the
`provider` map in `nola.config.ts`. A string literal, a variable expression or
a parenthesized expression will not parse.

```tsi
export infer function summarize(.text: string, useFast: boolean) {
  // WRONG
  const a = ask with "fast" `a rough summary`: string;
  const b = ask with provider.fast `a rough summary`: string;

  // RIGHT — name it in nola.config.ts, then use that name
  const c = ask with fast `a rough summary`: string;

  // RIGHT — dynamic choice
  const d = ask (..`a rough summary`: string).withModel(useFast ? "fast" : "careful");

  return { a, b, c, d };
}
```

```ts
// nola.config.ts
export default defineConfig({
  model: {
    default: openai({ model: "gpt-5-mini" }),
    fast: openai({ model: "gpt-5-nano" }),
  },
});
```

## NOLA1010 — `.` on a non-infer function

> `.` context parameters are only allowed on infer function parameters.

Also raised for a `const .x` / `let .x` binding outside an infer body or the
module body (inside a plain function, a callback, a class).

```tsi
// WRONG — a plain function has no inference context to put the value in
function summarize(.text: string) {
  return text.slice(0, 10);
}

// RIGHT
export infer function summarize(.text: string) {
  return ask `a one-sentence summary`: string;
}
```

If the function is genuinely plain TypeScript, drop the `.`; the parameter is
an ordinary argument.

## NOLA1019 — the marker slot is reserved

> the marker after an infer function's name is reserved for a future Nola version — write the instruction as a context statement in the body: `…`.

```tsi
// WRONG — the instruction in the reserved slot
export infer function f`be terse`(.t: string) {
  return ask `the kind`: string;
}

// RIGHT — a context statement in the body
export infer function f(.t: string) {
  `be terse`
  return ask `the kind`: string;
}
```

## NOLA2001 — `ask` outside a scope body

> `ask` is only allowed directly inside an infer function body or the module body.

`ask` is legal DIRECTLY in an infer function body or DIRECTLY in the module
body (top-level statements, top-level blocks/loops/try). It is not legal
inside a plain function or a nested closure — not even one written inside an
infer function — nor in a class field initializer or `static` block.

```tsi
// WRONG
const g = async () => ask `the kind`: string;         // plain closure

export infer function f(.t: string) {
  const h = () => ask `the kind`: string;             // nested closure
  return h();
}

// RIGHT — ask directly in the body, or at the top level of the module
export infer function f(.t: string) {
  return ask `the kind`: string;
}
export const kind = ask f("…");
```

Constructing an extractor outside a body is fine — only resolving it is
restricted:

```tsi
export const nameIntent = ..`the user's full name`: string;   // legal, inert
```

## NOLA2014 — a typed template outside `ask` and a call's slots needs the dots

> a typed template literal is an extractor only directly after `ask` or in a call's argument list; write ..`…`<T> here.

The `..` is implied directly after `ask` and in a call's slots (an argument,
or a value nested in plain object/array literals there). Anywhere else a bare
template is an ordinary string, so an extractor there needs its sigil. The
code is raised for the angle-bracket spelling; a colon-typed template in such
a place (`` const stored = `the user's full name`: string ``) is a plain
syntax error instead:

```tsi
declare function createTicket(title: string): Promise<string>;

infer function file(.request: string) {
  const wrong = `a short title`<string>;                        // NOLA2014 — stored: dots required
  const right = ask createTicket(`a short title`: string);      // a slot: the dots are implied
  return right;
}
export const stored = ..`the user's full name`: string;         // stored: dots required
```

## NOLA1018 — a colon type with nothing on its line

> expected a type after the extractor's `:` on the same line — write `…`: T.

The colon spelling `` ask `the ticket id`: string `` needs the colon glued to
the backtick (a colon after a space is a ternary's, never the extractor's) and
the type on the colon's line. Two more traps come with it, both from the type
having no closing delimiter:

```tsi
interface User { name: string }

infer function f(.doc: string) {
  const a = ask `the user`: User.withRetry(2);       // the TYPE `User.withRetry`, called with 2 — TS error
  const b = ask `the user`<User>.withRetry(2);       // RIGHT
  const c = ask `the tags`: string[].withRetry(2);   // RIGHT — a delimited type ends the type
  return { b, c };
}
```

A bare type name followed by `.` continues as a qualified type name, and `<`
after a type name opens type arguments (`` `n`: User < 5 `` is not a
comparison). Chain intent methods after a parenthesized extractor
(`` ask (..`the user`: User).withRetry(2) ``), after a delimited type
(`string[]`, `Array<User>`, `{…}`, `(User)`), or after `<T>`.

## NOLA1020 — a value in a context statement must be simple

> a value in a context statement is a name, a call or a bracketed expression,
> followed by text or the end of the statement — wrap anything else in
> parentheses, or assign it to a local first (`await`, `ask` and `this` cannot
> be values).

```tsi
export infer function total(.items: string[], a: number, b: number) {
  // WRONG — an operator after a value
  `total` a + b `items`;
  // RIGHT
  `total` (a + b) `items`;
  return ask `a summary`: string;
}
```

`this` is the same kind of mistake: an item is a hoisted function of its own,
so its `this` is not the infer function's. A bare `this` after text is
NOLA1020; in parentheses or in a `${}` hole it is TS2683 in `nola check` and
the editor (and `undefined` at run time). Assign it to a local first:

```tsi
export infer function greet(this: { user: string }) {
  // WRONG — NOLA1020 (bare `this`); `(this.user)` and `${this.user}` are TS2683
  `Greet` this.user `warmly.`;
  // RIGHT — a local, then its name
  const user = this.user;
  `Greet` user `warmly.`;
  return ask `a one-line greeting`: string;
}
```

Also:

- A value never ends with a backtick: `` `x` foo<string> `more` `` and
  `` `x` new Foo `more` `` are NOLA1020 too (the text would be read as a
  tagged template) — write `(foo<string>)`, `(new Foo)` or `new Foo()`.
- `typeof`, `void`, `await`, `ask`, `this`, `..`, `function` and `class`
  right after text are NOLA1020. Parenthesize `typeof`, `void`, functions and
  classes. `await`, `ask` and `this` cannot be values even in parentheses (an
  item is read at each ask, outside the async body, in a function of its own:
  `(await x)` is TS1308, `(this.x)` is TS2683, `(ask …)` is NOLA2010) —
  compute the value into a `const` first and write its name.
- A NAME at the start of a line begins a new statement (JavaScript's own
  rule), so `` `analyze` `` on one line and `foo(x)` on the next are a context
  statement and a call. Keep values on the text's line, or start the line with
  `(` or `[`.
- The mirror image: a CODE line that starts with `[` or `(` right after a
  context statement continues it and becomes its value — no error, but
  whatever the code returns (`undefined` for a `forEach`) lands in the
  prompt, and the code runs at every ask. End the context statement with
  `;`.

## An operator after the text is not a context statement

No diagnostic: `` `Page ` + oncall `` is ordinary JavaScript — a string
concatenation whose result is dropped — so the model never sees it.

```tsi
export infer function page(.ticket: string, oncall: string) {
  // WRONG — plain concatenation, nothing reaches the model
  `Page ` + oncall + ` when the ticket is an outage.`;
  // RIGHT — juxtapose the parts, or use a hole
  `Page` oncall `when the ticket is an outage.`;
  `Page ${oncall} when the ticket is an outage.`;
  return ask `the severity`: string;
}
```

## NOLA2017 — a context statement outside a scope body

> a context statement is only legal in a scope body — directly in an infer
> function or at module level.

> a context statement cannot be the unbraced body of an `if`, a loop or a
> label — wrap it in braces.

```tsi
export infer function go(.items: string[], urgent: boolean) {
  // WRONG — inside a callback, no ask can carry it
  items.forEach((it) => {
    `note` it;
  });
  // WRONG — an unbraced body
  if (urgent) `Answer quickly.`;
  // RIGHT — directly in the body, before the asks that should see it
  `items:` items;
  return ask `a summary`: string;
}
```

A class `static` block and a namespace body are outside a scope body too.
Inside braces (`if (urgent) { … }`) a context statement is legal and applies
to the asks inside them.

## NOLA2002 — a type the compiler cannot turn into a schema

> unsupported type for intent schema: …

An extractor's type must RESOLVE to a JSON-shaped value — the TypeScript
checker decides, so unions (`Refund | Chargeback`, `string | null`),
`Partial<T>` / `Pick` / `Omit`, `interface … extends`, intersections,
`Record<string, T>`, tuples, generics applied with arguments and types from
other files or packages all derive. `Map`, `Set`, `Promise`, `RegExp`,
functions and a generic declaration used without arguments (`Box<T>` — write
`Box<number>`) are not derivable; the error names the member at fault.

```tsi
export infer function tally(.doc: string) {
  // WRONG
  const wrong = ask `counts per label`: Map<string, number>;

  // RIGHT — a JSON-shaped type; convert afterwards in plain TS
  const counts = ask `counts per label`: { label: string; count: number }[];
  const asMap = new Map(counts.map((c) => [c.label, c.count]));
  return asMap;
}
```

Always give an extractor a concrete type in an expression position. An
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
  return ask `the label with the highest count`: string;
}

// RIGHT — pass a JSON-shaped view as the contextual parameter
export infer function topLabel(.index: { label: string; count: number }[]) {
  return ask `the label with the highest count`: string;
}

// RIGHT — keep the exotic value, but as a PLAIN parameter (the LLM never
// sees its value, so nothing needs deriving)
export infer function topLabel(.summary: string, index: Map<string, number>) {
  const label = ask `the label with the highest count`: string;
  return { label, count: index.get(label) ?? 0 };
}
```

If you must keep an underivable member on a contextual type, relax the policy
in `nola.config.ts` — `"prune"` drops just the underivable members and keeps
the rest of the type; `"omit"` drops the whole type silently:

```ts
export default defineConfig({
  model: openai({ model: "gpt-5-mini" }),
  compiler: { underivableContextType: "prune" },   // default is "error"
});
```

Keep that value a literal — the editor reads it statically and never executes
your config.

## NOLA2004 — a call-intent slot with no type

> an extractor used as a call-intent argument must have an explicit type — write ..`…`: T here.

```tsi
declare function createTicket(title: string, priority: number): Promise<string>;

export infer function fileTicket(.request: string) {
  // WRONG — the slot has no type
  const wrong = ask createTicket(..`a short ticket title`, 2);

  // RIGHT (the slot's `..` is implied; `..`a short ticket title`: string` works too)
  const id = ask createTicket(`a short ticket title`: string, 2);
  return id;
}
```

A bare template with no type, `` createTicket(`a short ticket title`, 2) ``,
is not a slot at all: it is a plain string argument and the call stays an
ordinary call — no error, and no model request.

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

- A `.tsi` specifier is either a Nola file or the view of a plain module:
  `./models.tsi` works when only `models.ts` exists (NOLA2007 when neither
  does). Do not keep `models.ts` AND `models.tsi` side by side.

```ts
import { Person } from "./models.tsi";        // RIGHT — the interface and its InferType value
import type { Person } from "./models.js";    // RIGHT — type only, for a schema in a .tsi
import { Person } from "./models.js";         // WRONG — kept at run time; models.js exports no VALUE named Person
```

- The `type` keyword is REQUIRED for a type-only import from a plain module:
  like Node's own `.ts` handling, `nola run` strips types without rewriting
  imports, so a bare `import { Person }` fails when the module loads.

## Never write generated-code names

`__nola` and any identifier starting with `__nola` are reserved in `.tsi`.
`__nola.ask(...)`, `__nola.intents.ExtractIntent(...)`, `__nola.types.string()`
and `__nola_module_ctx()` are what the compiler EMITS — they are not an API you
call, and writing them by hand is an error.

```tsi
export infer function read(.doc: string) {
  // WRONG — this is emitted code, not a user-facing API
  const wrong = await __nola.ask(
    __nola.intents.ExtractIntent({ instruction: "the value", type: __nola.types.string(), loc: "1:1" }),
    __frame,
  );

  // RIGHT
  const v = ask `the value`: string;
  return v;
}
```

## NOLA2010 — a Nola construct inside a context statement or a hole

> Nola constructs are not allowed inside a context statement or an instruction
> literal's hole; a hinted call intent used as a value must be parenthesized.

A context statement is read at each ask, outside the async body, and call
hints are re-emitted from source, so `ask` and `..` cannot appear in a context
statement's parenthesized value, bracketed value or `${}` hole, nor in a call
hint's hole (written bare right after the text, they are NOLA1020). A call
intent is a legal value, but a HINTED one, `` fn`hint`(…) ``, must be
parenthesized or written in a `${}` hole (an empty marker too): bare, the
backtick after `fn` is read as the next text part and the arguments as a
value of their own, so it is no call intent — a `` ..`x`: T `` in the
arguments is left as a bare extractor, and that is this error (a `` `x`: T ``
there is a syntax error at its colon, since a parenthesized group has no
slots); plain arguments may raise no error at all and render the wrong text.
A sigil-less call intent (`` fn(`x`: T) ``) needs no parentheses. Otherwise
compute the value first and interpolate the result, or move the ask into the
function body.

```tsi
declare function escalate(team: string): void;

export infer function route(.ticket: string) {
  // WRONG — the hint's backtick starts the next text part: NOLA2010 at the extractor
  `If the ticket is an outage,` escalate`page the on-call engineer`(..`the team to page`: string);
  // RIGHT — parenthesized (or written in a `${}` hole)
  `If the ticket is an outage,` (escalate`page the on-call engineer`(`the team to page`: string));
  // RIGHT — no hint, no parentheses
  `If the ticket is an outage,` escalate(`the team to page`: string);
  return ask `the label for the ticket`: string;
}
```

## NOLA3015 — running `.tsi` under Bun or Deno

The loader is Node's module-hooks API; Bun and Deno do not run it. Any package
manager is fine (`bun install`, `bun run start`, `pnpm start`, `yarn start` —
the `nola` bin is a Node script), but `bun --bun`, `bun src/main.ts` and
`deno run` cannot load `.tsi`. Run on Node: `nola run` or
`node --import nola-lang/register src/main.ts`.

## Other things that will not parse

- `async infer function f(...)` — an infer function is never `async` in source;
  `await` is already legal in its body.
- `export default infer function f(...)` — export by name instead.
- `infer` on a method, arrow function or function expression — top-level
  function declarations only.
- `fn(..)` — the bare derive-all call form is reserved (NOLA1004).
- `` ask `p` : T `` — a colon after a space is not the extractor's type; only a
  colon glued to the closing backtick is (`` `p`: T ``). In a ternary the
  spaced colon is the separator.
