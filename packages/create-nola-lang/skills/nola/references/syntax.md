# Nola syntax reference

Everything valid in TypeScript is valid in a `.tsi` file. This file documents
only the additions. `ask` and `with` are reserved words in `.tsi` (`ask` stays
legal as a member/property name); `infer` is a keyword only directly before
`function` at statement or export position, so `T extends infer U` in a
conditional type is untouched.

## `infer function`

An `infer function` declares an LLM-backed function. Calling one runs NOTHING:
it returns a lazy, thenable `Intent<T>`. The work happens when the intent is
resolved — with `ask` inside another infer function, or with `await` from
plain TS.

```tsi
// plain
infer function summarize(.text: string) {
  return ask `a one-sentence summary`: string;
}

// exported
export infer function classify(.message: string) {
  return ask `the category of the message`: string;
}

// a context statement: a bare template literal on its own line
export infer function triage(.ticket: string) {
  `triage the ticket like a support lead`
  return ask `the severity: low, medium or high`: "low" | "medium" | "high";
}

// text and values — the value is spliced into your words, like a ${} hole
export infer function escalate(.ticket: string, oncall: string) {
  `Page` oncall `when the ticket is an outage.`
  const steps: string[] = [];
  `Steps taken so far:` steps;          // read at EACH ask: the loop sees the current list
  while (steps.length < 3) steps.push(ask `the next step`: string);
  return steps;
}
```

Rules:

- Context statements: any bare template literal statement in a scope body
  (an infer body or the module body, at any depth of braces). Several are
  legal. An ask sees the statements written BEFORE it, in its block or an
  enclosing one — the `const .x` rule; each is read at each ask. Visibility
  is lexical, like a `const`: a statement inside a block reaches only the
  asks inside those braces (an ask after the block never sees it), and
  statements never accumulate across loop passes — each ask sees every
  statement visible at its position exactly once, rendered at that ask; only
  the values change between passes. A value is a
  name, a call or a bracketed literal (`[a, b]`, `{ a }`, `(a + b)`; a plain
  number, string or `true` works too); a `[` or `(` group takes its whole
  tail (`[a, b].filter(ok)` is one value). Parenthesize anything else: after
  a value an operator or arrow is NOLA1020, and so is a value that ENDS with
  a backtick (`` foo<string> `more` ``, `` new Foo `more` `` — write
  `(foo<string>)`, `(new Foo)` or `new Foo()`). `await`, `ask` and `this`
  cannot be values at all — assign the result to a local first
  (`const user = this.user;`, then `` `Page` user ``): an item is a hoisted
  function of its own, so a bare `this` is NOLA1020 and `this` in
  parentheses or in a `${}` hole is a TypeScript error (TS2683); see "Values
  in an instruction" for `await` and `ask`. A call intent is a value: a
  sigil-less one (`` `Page` fn(`x`: T) ``) as it stands, a HINTED one
  (`` fn`hint`(…) ``, an empty marker too) only in parentheses or a `${}`
  hole — bare, its backtick reads as the next text part, so it is no call
  intent (a typed template argument is then a syntax error at its colon, a
  `` ..`x`: T `` one NOLA2010; plain arguments raise no error and render
  the wrong text). An operator directly after the TEXT
  makes no context statement at all: `` `Page ` + oncall `` is ordinary
  string concatenation the model never sees — write `` `Page` oncall ``.
  Values never sit side by side; whitespace between parts is kept as
  written. LINES follow
  JavaScript: a line that starts with a backtick, `[` or `(` continues the
  statement; a line that starts with a NAME begins a new statement
  (`` `analyze` `` ⏎ `foo(x)` is a statement and a call — put `foo(x)` at
  the end of the text's line or in parentheses on its own line). Two
  backtick-led lines in a row are ONE statement (the second line's
  indentation stays in the text): end the first with `;` for two. The mirror
  hazard: a CODE line starting with `[` or `(` right after a context
  statement is taken as its value (its result lands in the prompt, and the
  code runs at every ask) — end the statement with `;`. A backtick literal
  between the name and the parameters (`` infer function f`…`(…) ``) is
  reserved — NOLA1019.
- The MODULE body takes the same statements and `const .x` bindings — see
  "The `ask` operator". A top-level module statement reaches the asks below
  it and the infer functions DECLARED below it: an ask inside one renders the
  module's `<context module="<file>">` block before the function's, whoever
  calls it, once. A function's OWN VIEW of the module is the top-level
  statements written above its declaration. A function declared ABOVE the
  statement does not see it on its own (a detached `await fn()` sees only the
  function's own view), but `ask fn()` from code that saw it — module code
  below the statement, an infer function declared below it — renders the
  block once with the caller's statements added. A statement inside a
  module-level block reaches a function only through an `ask fn()` written
  inside that block. Bindings are not carried.
- A context statement in a plain function, a callback, a static block or a
  namespace body — or as the UNBRACED body of an `if`/`else`/loop/label — is
  NOLA2017 (put braces around the body). In a file with no `ask` and no
  infer function a lone text statement is left as written (plain JavaScript,
  a no-op), but a statement of two or more parts makes the file use the
  runtime and every context statement in it an item.

- Top-level function declarations only. `infer` on a method, arrow function,
  or function expression is a plain parse error (NOLA1001).
- `async infer function` is a parse error — an infer function is never `async`
  in source; it is implicitly awaitable through `Intent`.
- `export default infer function` does NOT parse. Export by name
  (`export infer function f(...)`) and let consumers import the name.
- `ask` is legal only DIRECTLY inside an infer function body or DIRECTLY in
  the module body — not inside a plain function or a nested closure
  (NOLA2001). A top-level `ask` runs as its own `<module>` invocation (a root
  frame: events, trace, timeout); `ask fn()` at the top chains `fn` under it,
  `await fn()` does not. Importing such a module RUNS its asks — right for a
  script, wrong for a library.
- `await` IS legal inside the body, for ordinary promises (fetch, DB, any
  library):

```tsi
export infer function enrich(.handle: string, fetchProfile: (h: string) => Promise<string>) {
  const profile = await fetchProfile(handle);       // ordinary promise
  return ask `the person's job title from: ${profile}`: string;
}
```

### Return type annotation

Leave the return type off and let it infer — that is what every example in
this repo does. When you do annotate, the annotation is `Intent<T>` (the body
returns `T`, the way an `async` function body returns `T` under `Promise<T>`):

```tsi
import type { Intent } from "@nola-lang/runtime";

interface User {
  name: string;
}

export infer function getUser(.message: string): Intent<User> {
  const user = ask `the user described in the message`: User;
  return user;
}
```

Do NOT annotate it `Promise<T>`: `Intent<T>` is `PromiseLike<T>`, not a
`Promise`, so `nola check` reports TS2739 (missing `catch`, `finally`,
`[Symbol.toStringTag]`).

## `.` contextual parameters

A parameter prefixed with ONE dot is a CONTEXT parameter: its name, type and
runtime VALUE are composed into the prompt of every `ask` in that invocation.
A plain parameter is an ordinary JS argument — its name and type reach the
LLM, its value does not. Mnemonic: one dot IN (`.name`); a template after
`ask` OUT — `` ..`prompt` `` spells the same request where neither `ask`
nor a call's argument list is in front of it. Writing `..name` on a
parameter is NOLA1013.

```tsi
export type Issue = { id: string; description: string };

// `issue` is visible to the LLM; `fallback` is a normal JS value only.
export infer function classifyIssue(.issue: Issue, fallback: string) {
  const kind = ask `the kind of this issue`: string;
  return kind || fallback;
}
```

- `.` is legal on infer-function parameters and on `const`/`let` bindings
  directly in an infer body or the module body (below). Anywhere else it is
  NOLA1010.
- A contextual parameter's TYPE must be derivable to an inference schema:
  whatever the TypeScript checker resolves to a JSON shape — scalars, `Date`,
  arrays, objects, unions, `Partial`/`Pick`/`Omit`, `extends`, `Record`,
  tuples, generics applied with arguments, types from other files or
  packages. `Map`, `Set`, `Promise`, functions and a bare generic
  declaration are NOT derivable and raise NOLA2008 under the default policy.
- Several contextual parameters are fine; they compose into one context block:

```tsi
export infer function nextQuery(.question: string, .notes: string[]) {
  return ask `the single best search query to advance the research`: string;
}
```
- `const .x = …` / `let .x = …` is a contextual BINDING: context for every
  `ask` after it in the same body (lexical — its block or an enclosing one;
  never its own initializer). It renders after the parameters in the CONTEXT
  block, reads its CURRENT value at the ask, derives an annotation like a
  parameter (same `underivableContextType` policy), and travels to a callee
  through `ask fn()`. At module level it gives the `<module>` scope its
  CONTEXT block; it does NOT reach infer functions merely declared in the
  file (a module context statement does, in the functions declared below
  it — see "infer function"). `var .x` is NOLA1014; a pattern is NOLA1011.

```tsi
export infer function reply(.mail: string) {
  const .tone = "brief, friendly";
  const .customer: Customer = await loadCustomer(mail);
  return ask `a reply to the mail`: string;
}
```

## Extractors — `` ask `instruction`: T `` and `` ..`instruction`: T ``

An extractor is the request itself: instruction text in backticks plus an
optional type argument. Directly after `ask` (and after `ask with <name>`),
and as a typed slot in a call's arguments (`` createTicket(`title`: string, 2) ``),
the backticks alone are the extractor; everywhere else it is written with two
leading dots so it cannot be mistaken for a string.

```tsi
export infer function parse(.doc: string) {
  const id = ask `the ticket id`: string;             // typed
  const count = ask `how many line items`: number;
  const free = ask `think step by step about the document`;  // untyped
  return { id, count, free };
}
```

- `${expr}` interpolation is legal inside the backticks and is evaluated at
  intent-construction time. Strings splice as-is; anything else is
  JSON-stringified. A hole cannot contain a Nola construct (NOLA2010):

```tsi
interface Person {
  name: string;
  age: number;
}

export infer function lookup(text: string) {
  return ask `the person described in: ${text}`: Person;
}
```

- With no type, the extractor asks for free text: the wire schema is a plain
  string and the static TS type is `any`. Give every extractor an explicit
  type unless you deliberately want unconstrained prose.
- TWO SPELLINGS OF THE TYPE, one construct. `: T` — a colon GLUED to the
  closing backtick, like an annotation — is the taught form and what every
  example writes. `<T>` — a type argument after the backtick — is the same
  construct: `` ask `the ticket id`<string> ``, `` ..`x`<T> ``,
  `` fn(`x`<T>) ``, `` ask `q`<Choice<C>> `` — same AST, same emit, same
  definition, same ledger entries; legal everywhere `: T` is. Rules for the
  colon: a colon after whitespace is never the extractor's (so
  `` cond ? ask `p` : fallback `` stays a ternary over an untyped ask, and
  `` cond ? ask `p`: number : fallback `` asks for a number); the type starts
  on the colon's line (NOLA1018 otherwise); a type NAME followed by `.`
  continues the type (`` `p`: User.withRetry(2) `` is the type
  `User.withRetry` called with 2) — chain intent methods after a
  parenthesized extractor (`` ask (..`p`: User).withRetry(2) ``), a
  delimited type (`string[]`, `Array<User>`, `{…}`, `(User)`) or `<T>`;
  `<` after a type name opens type arguments with either spelling.
- The `..` is implied in two places: directly after `ask` (the template is
  the operand's first token) and in a call's SLOTS — a typed template that
  starts an argument, or a property value / element of a plain object or
  array literal written in the arguments: `` fn(`x`: T) ``,
  `` api.save({ note: `x`: T }) ``, `` fn([`x`: T]) ``. Everywhere else it is
  required: `` const i = ..`x`: T ``, `` fn(cond ? ..`x`: T : y) ``,
  `` fn(...[..`x`: T]) ``, `` new Foo(..`x`: T) ``,
  `` ask (..`x`: T).withRetry(2) `` (parenthesized: the template is no longer
  a first token — `` fn((`x`: T)) `` is a syntax error too). A `` `x`<T> ``
  outside those places is NOLA2014; a `` `x`: T `` there is a plain syntax
  error. An UNTYPED template in a slot is a plain string argument
  (`` log(`done`) `` is an ordinary call), and in a slot `<` starts type
  arguments only when `<…>` reads as such (`` fn(`a` < b) `` stays a
  comparison). `` ask ..`x`: T `` and `` fn(..`x`: T) `` are still legal and
  lower identically. The SPACE is mandatory after `ask`: `` ask`x` ``
  (backtick glued to `ask`, or to the name after `ask with`) is NOLA1017 —
  it reads as a tagged template.
- DECISION TYPES (intrinsic, no import): `Choice<{ billing: "Payments";
  sales: null }>` (or `Choice<"a" | "b">`, 2–255 labels; number labels too,
  alone or mixed — `Choice<1 | 2 | 3>` / `Choice<{ 1: "Low"; 2: "High" }>` /
  `Choice<1 | "other">`: a label written as a number comes back as the
  number under `choice`, `probabilities` is always keyed by the label's
  text, `probabilities["2"]`; `1 | "1"` share a text and are NOLA2015)
  evaluates to
  `{ choice, probabilities, confidence? }`; `Scale<["Calm", "Civil",
  "Angry"]>` (2–10 ordered levels) to `{ score, probabilities, levels,
  confidence? }` where `score` is the fractional expected level; `Prob` /
  `Prob<{ true: "…"; false: "…" }>` to the probability of yes (a number).
  The plain forms stay: a literal union is the label, `boolean` a yes/no cut
  at 0.5. RULE: adding criteria changes what the property evaluates to. A
  type containing a decision type needs a DECISION model (`typesafe()`,
  `mockProvider(replies, { decisions: true })` in tests) — on a chat model it
  is NOLA3018 before the network. There is NO `..choice` / `..scale` /
  `..prob` sugar (retired 2026-09-23; an identifier after `..` is NOLA1005):
  write the type long-hand — `` ask `Which team?`: Choice<{ billing:
  "Payments"; sales: null }> ``, `` ask `How bad?`: Scale<["low", "high"]> ``,
  `` ask `Urgent?`: Prob ``; malformed criteria are NOLA2015.
- The type accepts whatever resolves to a JSON shape: scalars, `Date`, arrays,
  tuples, object literals, aliases/interfaces (same file, another file, a
  package; `extends`, intersections, `Partial`/`Pick`/`Omit`, instantiated
  generics), string-literal unions and string enums, object and nullable
  unions, `Record<string, T>`. JSDoc comments on members become schema
  descriptions:

```tsi
export interface Conclusion {
  answer: string;
  /** the collected notes that directly support the answer */
  evidence: string[];
}
```

- An extractor may be CONSTRUCTED anywhere in a `.tsi` file, module level
  included — construction needs no context. Only `ask` is position-restricted
  (infer body or module body):

```tsi
export const nameIntent = ..`the user's full name`: string;   // legal, inert
```

## The `ask` operator

`ask` is a unary prefix operator with `await`'s precedence. It resolves any
`Askable` — an extractor, a call intent, or the `Intent` returned by calling
an infer function — to its value.

```tsi
import { getUserById } from "./users.tsi";

type User = { name: string };

export infer function report(.text: string) {
  const user = ask `the user named in the text`: User;   // extractor
  const record = ask getUserById(user.name);               // another infer function
  return record;
}
```

### `ask with <name>` — pin one ask to a provider

```tsi
export infer function summarize(.text: string) {
  const draft = ask with fast `a rough summary`: string;
  const final = ask with careful `a polished summary of: ${draft}`: string;
  return final;
}
```

- `<name>` must be a STATIC identifier. An extractor, a parenthesized
  expression, a string literal or anything else after `with` is NOLA1009 —
  use `.withModel(...)` for a dynamic model.
- The name is matched against the config at ask time, not compile time. A
  name that matches a `model` map key pins that model. When the platform
  serves inference (`model: "nola"`) an unmatched name is a
  free-form inference profile sent to the platform — not an error; under a
  local default an unknown name is a runtime `NolaConfigError` (NOLA3004).
- `ask without` is a plain ask of the identifier `without`, not a pin.

## Call intents

A call intent lets the LLM fill some of a function's arguments, then calls the
function with them. All slots of one call intent resolve in ONE provider call.

Three spellings:

```tsi
declare function createTicket(title: string, priority: number): Promise<string>;

export infer function file(.request: string) {
  // 1. sigil-less — a plain call whose arguments contain an extractor; the
  //    slot's `..` is implied (`..`a short ticket title`: string` still works)
  const a = ask createTicket(`a short ticket title`: string, 2);

  // 2. empty marker — identical lowering; the only spelling for a call
  //    intent whose arguments are all plain
  const b = ask createTicket``("fallback title", 3);

  // 3. hint marker — the ONLY carrier of instruction text for the call
  const c = ask createTicket`file the ticket the customer asked for`(
    `a short ticket title`: string,
    `priority 1-5, 1 is most urgent`: number,
  );

  return { a, b, c };
}
```

Detection rule for the sigil-less form — BOTH must hold:

- the callee is an `Identifier` or a `MemberExpression` (any nesting, computed
  included), and
- at least one well-formed extractor appears in a slot position: a direct
  argument, or nested at any depth inside plain object/array literals. In
  exactly those positions a typed template is an extractor without the `..`;
  an untyped one is a plain string argument.

```tsi
declare const api: { save(order: { qty: number; note: string }): Promise<string> };

export infer function place(.request: string) {
  // member callee + extractor nested in an object literal → call intent
  return ask api.save({ qty: 1, note: `a one-line note for the warehouse`: string });
}
```

These stay PLAIN calls (the extractor is just a value argument, and needs its
`..` there): an extractor inside a ternary, logical expression, spread element
or template substitution; a nested call (in `` outer(inner(`x`: T)) `` the
INNER call is the intent and
`outer` receives an `Askable`); `new Foo(...)`, `super(...)`, `import(...)`,
optional calls (`fn?.(...)`, `a?.b(...)`); and exotic callees (`getFn()(...)`,
IIFEs) — use the hint form `` fn`hint`(…) `` if you want a call intent on one of those.

Parenthesizing an extractor does NOT opt out. To pass an intent as a plain
value, bind it to a variable first:

```tsi
const i = ..`a short title`: string;
helper(i);                       // plain call — helper receives the Askable
```

Every extractor used as a call-intent slot must carry an explicit type
(NOLA2004). The bare derive-all form `fn(..)` is reserved (NOLA1004).

### Result of a call intent — async callees are awaited

`ask fn(...)` yields the callee's SETTLED value, exactly like `await fn(...)`
would: if the function returns a promise (or any thenable), the intent awaits
it before resolving. Its static type is `Awaited<ReturnType<typeof fn>>`. Never
write `await ask fn(...)` — the extra `await` is a no-op.

```tsi
declare function createTicket(title: string, priority: number): Promise<string>;

export infer function file(.request: string) {
  const id = ask createTicket(`a short ticket title`: string, 2); // id: string, not Promise<string>
  return id;
}
```

Two consequences to keep in mind:

- The callee runs INSIDE the ask, so a rejected promise fails the ask at the
  call site (NolaResolutionError with the intent's location) — and
  `.withRetry(n)` re-runs the WHOLE ask, including the callee. Do not put
  `.withRetry` on a call intent whose target is not idempotent.
- The invocation timeout (`ask.timeoutMs` / `.withTimeout`) bounds provider
  round trips only. Once the arguments are filled, the callee's own promise
  runs to completion, the same as a plain `await fn()` in your code.

## Values in an instruction: `.x` and `${x}`

Two spellings put a value in front of the model — pick by what the model
should treat it as.

```tsi
// data: an <input> block the system turn marks as "data, not instructions"
infer function triage(.ticket: string) {
  `Answer with the order id only.`
  return ask `order id`: string;
}

// your words: a value YOU control, spliced into the instruction where it stands
infer function triageFor(.ticket: string, team: string) {
  `You answer for the ${team} team. Answer with the order id only.`
  return ask `order id`: string;
}
```

- `.name` renders as `<input name="name">` after the instruction; a plain
  parameter is never rendered. Both spellings on one value put it in the
  prompt twice.
- Trust: interpolated text is INSTRUCTIONS the model follows. Interpolate
  only what the developer controls (a team name, a count, a date); a
  customer's message, a document, anything a user typed goes in `.name`,
  where the system turn marks it as data.
- `${expr}` is ordinary TypeScript in EVERY instruction literal — a
  context statement, an extractor prompt, a call hint. A string splices
  verbatim; anything else is JSON (a `Date` as a quoted ISO string — write
  `${d.toISOString()}` for bare text; `undefined` as `undefined`).
- When it is read: a context statement at EACH ask that sees it (a value
  must be initialized by then — a `let` or `const` declared after the ask
  is a ReferenceError at that ask); an extractor's prompt and a call hint when
  the ask expression runs. A value after text in a context statement is the
  same as a `${}` hole: `` `Page` oncall `…` `` ≡ `` `Page ${oncall} …` ``.
- A custom format is a function call in a hole (`${table(a, b)}`); a value
  kept out of the prompt is a dotless parameter.
- Errors: a Nola construct (`..`, `ask`) in a context statement (a
  parenthesized value, a hole) or in a call hint's hole is NOLA2010 — bare
  right after a statement's text it is NOLA1020. A call intent is a legal
  value in a context statement — it renders as its callee and arguments; a
  HINTED one (`` fn`hint`(…) ``) must be parenthesized or written in a `${}`
  hole (bare, the hint's backtick reads as the next text part: an extractor
  argument is then NOLA2010). A bare `await` or `this` right after a statement's
  text is NOLA1020; anywhere else in a value or hole it is a TypeScript
  error (an item is read at each ask, outside the async body, in a function
  of its own — TS1308 for `await`, TS2683 for `this`): compute the value
  first, or assign `this` to a local. There is no
  `${.member}` prompt scope: a dot cannot start a hole's expression (an
  ordinary syntax error).
- Editor: completion, hover and TypeScript errors work inside `${…}`.

## The prompt

What reaches the model is the developer's text in four utility tags —
nothing else of Nola's is in the user turn:

- `<context function="f">` / `<context module="path">`: one scope — its
  context statements (each starting on its own line), then one
  `<input name="x">` per contextual param and `const .x` binding (a string
  verbatim, anything else as JSON). Plain params are NOT rendered. Outermost
  caller first, asking scope last.
- `<task>` last: the extractor's instruction; a call intent is
  `<task call="fn">hint</task>` (self-closing without a hint).
- `<correction>` on the retry, after the rejected reply.
- The schema is NEVER in the prompt: it rides the provider's structured
  output (`structuredOutputs: false` on a vendor factory puts it in the
  system turn as `<schema>` for servers that cannot enforce it).
- The system turn is four constant sentences (`DEFAULT_SYSTEM`, exported
  from `@nola-lang/providers`); `system.message` in the config REPLACES it.
- Every provider implements `infer(req)` over `req.intent` (the ask as
  data) and renders it itself — `renderPrompt(req.intent)` is the default.
  A model that still implements `complete(req)` is NOLA3003.

## Intent methods

Every intent (extractor, call intent, infer-function result) accepts:

```tsi
export infer function tuned(.text: string) {
  const a = ask (..`the title`: string).withRetry(2);
  const b = ask (..`the body`: string).withModel("careful");
  const c = ask (..`a creative tagline`: string).withParams({ temperature: 0.9, maxOutputTokens: 200 });
  const d = ask (..`a one-paragraph summary`: string).withTimeout(10_000);
  return { a, b, c, d };
}
```

- `.withRetry(n)` — `n` extra whole-ask attempts, flat, no backoff.
- `.withModel(nameOrProvider)` — the dynamic form of `ask with`.
- `.withParams({ temperature, maxOutputTokens, providerOptions })` — wire knobs,
  merged per field with anything already set.
- `.withTimeout(ms)` — bounds that intent's provider round trips. Inside a
  body it sits next to the invocation's clock (whichever fires first; it can
  tighten, never loosen; `0` sets none). On an intent that ROOTS an invocation
  — an infer-function result awaited from plain TS — it replaces
  `ask.timeoutMs` for that invocation.

`.detached()` exists ONLY on the `Intent` an infer function returns:

```ts
import { extractPerson } from "./person.tsi";

const person = await extractPerson(text).withTimeout(30_000);
const loose = await extractPerson(text).detached();   // do not inherit the caller frame's context
```

All of these CLONE the intent — the original stays unstarted, and an intent
resolves at most once.

## Types as values

Every `export type` and `export interface` in a `.tsi` is ALSO exported as a
runtime value of type `InferType<T>` under the same name. No syntax, no
opt-in; `import { type User }` keeps only the type. Enums are already values
and are left alone; non-exported types get no value.

```tsi
// user.tsi
export interface User {
  name: string;
  email?: string;
  role: "admin" | "member";
}
```

```ts
// api.ts — plain TypeScript
import { User } from "./user.tsi";

User.toJsonSchema();          // JSON Schema (draft 2020-12 shape: properties/required/additionalProperties)
User.validate(input);         // { ok: true, value } | { ok: false, issues: { path, message }[] }
User.parse(input);            // the value, or throws NolaValidationError (NOLA3016)
User["~standard"];            // Standard Schema v1 (vendor "nola") for form/router/agent libraries
User["~standard"].jsonSchema.input({ target: "openapi-3.0" }); // Standard JSON Schema: draft-2020-12 | draft-07 | openapi-3.0 (else NOLA3017)
```

Rules:

- Those four members ARE `InferType<T>` — there is no `describe`, `revive`
  or schema-node access on a type value; the extractor machinery behind it is
  not API.
- A `const`/`let`/`var`/`function`/`class`/`enum` named like an exported
  type is NOLA2011 — rename one of them.
- `validate` reports EVERY issue (not just the first) and revives `Date`
  fields to real `Date`s, exactly like an extractor result. Derivation covers
  what extractors cover (the resolved type, unions and utility types
  included); an underivable exported type is an `UnsupportedType<reason>`
  value — calling a method on it is a compile-time error carrying the reason.
- CONSTRAINTS: a JSDoc tag on a property or a type alias, named like the
  JSON Schema keyword, becomes that keyword in the schema AND is enforced by
  validation (the correction turn quotes the exact message). Strings:
  `@minLength n` `@maxLength n` `@pattern re` `@format name` (date-time,
  date, time, email, uri, uuid, ipv4, ipv6, hostname); numbers: `@minimum n`
  `@maximum n` `@exclusiveMinimum n` `@exclusiveMaximum n` `@multipleOf n`
  `@integer`; arrays/tuples: `@minItems n` `@maxItems n` `@uniqueItems`.
  Several tags share one comment with the description
  (`/** the handle @minLength 3 @pattern ^[a-z]+$ */`). The tag applies to
  the non-null part (`string | null` is fine); a tag on an alias travels with
  the alias. Wrong kind, unknown format, bad value or a repeated tag is
  NOLA2012 at the type — never put `@minLength` on a number or `@minItems`
  on an object.
- VIEWS: `./x.tsi` means the Nola file `x.tsi` when it exists, otherwise the
  view of `x.ts` (then `x.d.ts`) — the same module re-exported plus a value
  per exported alias/interface. That is how a type declared in ordinary
  TypeScript gets the same API (`import { Person } from "./models.tsi"`
  with only `models.ts` on disk). Neither file present is NOLA2007.
- TYPES ONLY: a plain-TS project with NO `.tsi` file and NO `nola.config.ts`
  can use Nola just for these values — `nola-lang` as a devDependency,
  `@nola-lang/runtime` as the runtime dep, `./x.tsi` view imports, run under
  `node --import nola-lang/register`, type-check with `nola check` (or
  `nola declarations` + `allowArbitraryExtensions` for plain tsc), bundle
  with a bundler plugin for production. No provider, no key.
- Keep one basename per module: `x.ts` next to `x.tsi` is allowed but
  `./x.tsi` always means the Nola file, and `nola build`/`nola check` warn.
- Turbopack: real `.tsi` files work and generated view imports are inlined,
  but a hand-written `./x.tsi` import of a plain module in `.ts` is not
  supported there — use webpack mode.
