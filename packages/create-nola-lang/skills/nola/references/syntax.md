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
  return ask ..`a one-sentence summary`<string>;
}

// exported
export infer function classify(.message: string) {
  return ask ..`the category of the message`<string>;
}

// with an instruction marker between the name and the parameter list
export infer function triage`triage the ticket like a support lead`(.ticket: string) {
  return ask ..`the severity: low, medium or high`<"low" | "medium" | "high">;
}
```

Rules:

- Top-level function declarations only. `infer` on a method, arrow function,
  or function expression is a "reserved for a future Nola version" error.
- `async infer function` is a parse error — an infer function is never `async`
  in source; it is implicitly awaitable through `Intent`.
- The instruction marker is a template literal. `${expr}` holes interpolate
  lexical values into the instruction; a `${.member}` hole makes the marker a
  prompt TEMPLATE for the function's CONTEXT block (see "Prompt templates").
- `export default infer function` does NOT parse. Export by name
  (`export infer function f(...)`) and let consumers import the name.
- `ask` is legal only DIRECTLY inside an infer function body — not at module
  level, not inside a nested closure (NOLA2001).
- `await` IS legal inside the body, for ordinary promises (fetch, DB, any
  library):

```tsi
export infer function enrich(.handle: string, fetchProfile: (h: string) => Promise<string>) {
  const profile = await fetchProfile(handle);       // ordinary promise
  return ask ..`the person's job title from: ${profile}`<string>;
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
  const user = ask ..`the user described in the message`<User>;
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
LLM, its value does not. Mnemonic: one dot IN (`.name`), two dots OUT
(`` ..`prompt` ``). Writing `..name` on a parameter is NOLA1013.

```tsi
export type Issue = { id: string; description: string };

// `issue` is visible to the LLM; `fallback` is a normal JS value only.
export infer function classifyIssue(.issue: Issue, fallback: string) {
  const kind = ask ..`the kind of this issue`<string>;
  return kind || fallback;
}
```

- `.` is legal ONLY on infer-function parameters. On any other function it is
  NOLA1010.
- A contextual parameter's TYPE must be derivable to an inference schema:
  strings, numbers, booleans, `Date`, arrays, plain object/interface/type-alias
  shapes, string-literal unions, string enums, and same-file or imported
  references to those. `Map`, `Set` and other ambient lib types are NOT
  derivable and raise NOLA2008 under the default policy.
- Several contextual parameters are fine; they compose into one context block:

```tsi
export infer function nextQuery(.question: string, .notes: string[]) {
  return ask ..`the single best search query to advance the research`<string>;
}
```
- `const .x = …` (a contextual BINDING inside the body) is reserved for a
  future Nola version — NOLA1014 today.

## Extractors — `` ..`instruction`<T> ``

An extractor is the request itself: instruction text in backticks plus an
optional type argument.

```tsi
export infer function parse(.doc: string) {
  const id = ask ..`the ticket id`<string>;             // typed
  const count = ask ..`how many line items`<number>;
  const free = ask ..`think step by step about the document`;  // untyped
  return { id, count, free };
}
```

- `${expr}` interpolation is legal inside the backticks and is evaluated at
  intent-construction time. Strings splice as-is; anything else is
  JSON-stringified. A hole starting with a single dot (`${.type}`) is NOT a
  lexical value — it reads the extractor's prompt scope and turns the
  backticks into a prompt template (see "Prompt templates"):

```tsi
interface Person {
  name: string;
  age: number;
}

export infer function lookup(text: string) {
  return ask ..`the person described in: ${text}`<Person>;
}
```

- With no `<T>`, the extractor asks for free text: the wire schema is a plain
  string and the static TS type is `any`. Give every extractor an explicit
  `<T>` unless you deliberately want unconstrained prose.
- `<T>` accepts scalars, `Date`, arrays, inline object literals, same-file
  and imported non-generic aliases/interfaces, string-literal unions and
  string enums. JSDoc comments on members become schema descriptions:

```tsi
export interface Conclusion {
  answer: string;
  /** the collected notes that directly support the answer */
  evidence: string[];
}
```

- An extractor may be CONSTRUCTED anywhere in a `.tsi` file, module level
  included — construction needs no context. Only `ask` is position-restricted:

```tsi
export const nameIntent = ..`the user's full name`<string>;   // legal, inert
```

## The `ask` operator

`ask` is a unary prefix operator with `await`'s precedence. It resolves any
`Askable` — an extractor, a call intent, or the `Intent` returned by calling
an infer function — to its value.

```tsi
import { getUserById } from "./users.tsi";

type User = { name: string };

export infer function report(.text: string) {
  const user = ask ..`the user named in the text`<User>;   // extractor
  const record = ask getUserById(user.name);               // another infer function
  return record;
}
```

### `ask with <name>` — pin one ask to a provider

```tsi
export infer function summarize(.text: string) {
  const draft = ask with fast ..`a rough summary`<string>;
  const final = ask with careful ..`a polished summary of: ${draft}`<string>;
  return final;
}
```

- `<name>` must be a STATIC identifier naming a key of the `providers` map in
  `nola.config.ts`. An extractor, a parenthesized expression, a string literal
  or anything else after `with` is NOLA1009 — use `.withProvider(...)` for a
  dynamic provider.
- The name is matched against the config at ask time, not compile time; an
  unknown name is a runtime `NolaConfigError` (NOLA3004).
- `ask without` is a plain ask of the identifier `without`, not a pin.

## Call intents

A call intent lets the LLM fill some of a function's arguments, then calls the
function with them. All slots of one call intent resolve in ONE provider call.

Three spellings:

```tsi
declare function createTicket(title: string, priority: number): Promise<string>;

export infer function file(.request: string) {
  // 1. sigil-less — a plain call whose arguments contain an extractor
  const a = ask createTicket(..`a short ticket title`<string>, 2);

  // 2. empty marker — identical lowering; the only spelling for a call
  //    intent whose arguments are all plain
  const b = ask createTicket``("fallback title", 3);

  // 3. hint marker — the ONLY carrier of instruction text for the call
  const c = ask createTicket`file the ticket the customer asked for`(
    ..`a short ticket title`<string>,
    ..`priority 1-5, 1 is most urgent`<number>,
  );

  return { a, b, c };
}
```

Detection rule for the sigil-less form — BOTH must hold:

- the callee is an `Identifier` or a `MemberExpression` (any nesting, computed
  included), and
- at least one well-formed extractor appears in a slot position: a direct
  argument, or nested at any depth inside plain object/array literals.

```tsi
declare const api: { save(order: { qty: number; note: string }): Promise<string> };

export infer function place(.request: string) {
  // member callee + extractor nested in an object literal → call intent
  return ask api.save({ qty: 1, note: ..`a one-line note for the warehouse`<string> });
}
```

These stay PLAIN calls (the extractor is just a value argument): an extractor
inside a ternary, logical expression, spread element or template substitution;
a nested call (in `` outer(inner(..`x`<T>)) `` the INNER call is the intent and
`outer` receives an `Askable`); `new Foo(...)`, `super(...)`, `import(...)`,
optional calls (`fn?.(...)`, `a?.b(...)`); and exotic callees (`getFn()(...)`,
IIFEs) — use the marker form if you want a call intent on one of those.

Parenthesizing an extractor does NOT opt out. To pass an intent as a plain
value, bind it to a variable first:

```tsi
const i = ..`a short title`<string>;
helper(i);                       // plain call — helper receives the Askable
```

Every extractor used as a call-intent slot must carry an explicit `<T>`
(NOLA2004). The bare derive-all form `fn(..)` is reserved (NOLA1004).

### Result of a call intent — async callees are awaited

`ask fn(...)` yields the callee's SETTLED value, exactly like `await fn(...)`
would: if the function returns a promise (or any thenable), the intent awaits
it before resolving. Its static type is `Awaited<ReturnType<typeof fn>>`. Never
write `await ask fn(...)` — the extra `await` is a no-op.

```tsi
declare function createTicket(title: string, priority: number): Promise<string>;

export infer function file(.request: string) {
  const id = ask createTicket(..`a short ticket title`<string>, 2); // id: string, not Promise<string>
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

## Prompt templates — `${.member}`

Every instruction literal (infer-function marker, extractor prompt, call-intent
hint) can act as a TEMPLATE for the prompt block that intent contributes. One
rule: a substitution hole whose expression starts with a single dot reads the
intent's prompt scope; every other hole is ordinary lexical JavaScript.

```tsi
infer function analyze`${.default}
Rules: answer only from the arguments above; never invent ids.`(.ticket: Ticket) {
  const id = ask ..`ticket id, comply with ${.type}`<string>;
  return id;
}

// A full custom CONTEXT block — everything after the dot is plain TypeScript
infer function triage`
CONTEXT — inside ${.signature}, ${.file}
${.args.map(a => `- ${a.name} (${a.type}): ${JSON.stringify(a.value)}`)}

TASK
${.next}
`(.ticket: string) { … }
```

- Override rule (static): a literal with at least ONE `${.x}` hole is a
  template — its rendered text REPLACES that intent's block (CONTEXT for an
  infer function, TASK for an extractor / call hint). A literal with no scope
  hole is an instruction, exactly as before (`Purpose:` / `<request>` inside
  the built-in block), even when it has lexical `${}` holes.
- Function scope (`FunctionPromptScope`): `.fn`, `.signature`, `.file`,
  `.args[]` (`name`, `type` — native type text, `value`, `contextual`),
  `.nested`, `.hasContext`, `.default` (the built-in CONTEXT block, no
  Purpose line), `.next` (the rest of the prompt: callee blocks + TASK).
- Extractor / call-hint scope (`ExtractPromptScope`): `.type` (native type
  text of the target), `.schema` (the JSON Schema, serialized),
  `.hasContext`, `.default` (the built-in TASK block), `.format` (the JSON
  response rules).
- Safe by default: a function template that never reads `.next` gets the
  rest of the prompt appended after it; an extractor template that never
  reads `.format` gets the JSON response rules appended. Read them only to
  choose WHERE they go (wrapping). `.next`/`.default`/`.format` are
  getters, memoized — reading twice does not compose twice.
- Rendering: arrays render one item per line (no `.join` needed),
  `undefined`/`null` render as nothing, objects as JSON, `Date` as ISO.
  Templates render when the ask composes its prompt — lexical values inside
  a TEMPLATE are read then, not at construction (the only observable
  difference from an instruction's eager `${}`).
- Nested holes follow the same rule: `${.file}` inside a `.map` callback's
  own template literal still reads the scope. Keyword members work
  (`${.default}`).
- Editor: completion, hover and precise TS errors work inside the backticks
  (an unknown member is a TS2339 at the member).
- Errors: `${.x}` in a template literal that is not a Nola instruction is
  NOLA2009; a Nola construct (`..`, call intent, `ask`) inside a marker /
  call-hint hole is NOLA2010; a template that throws or renders empty fails
  the ask with NOLA3014 (definitive).

## Intent methods

Every intent (extractor, call intent, infer-function result) accepts:

```tsi
export infer function tuned(.text: string) {
  const a = ask (..`the title`<string>).withRetry(2);
  const b = ask (..`the body`<string>).withProvider("careful");
  const c = ask (..`a creative tagline`<string>).withParams({ temperature: 0.9, maxOutputTokens: 200 });
  return { a, b, c };
}
```

- `.withRetry(n)` — `n` extra whole-ask attempts, flat, no backoff.
- `.withProvider(nameOrProvider)` — the dynamic form of `ask with`.
- `.withParams({ temperature, maxOutputTokens, providerOptions })` — wire knobs,
  merged per field with anything already set.

Two more exist ONLY on the `Intent` an infer function returns (they act when
the intent roots an invocation), and are typically used from plain TS:

```ts
import { extractPerson } from "./person.tsi";

const person = await extractPerson(text).withTimeout(30_000);
const loose = await extractPerson(text).detached();   // do not inherit the caller frame's context
```

All of these CLONE the intent — the original stays unstarted, and an intent
resolves at most once.
