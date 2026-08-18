# Nola patterns — worked examples

## The starter project, end to end

This is the shape every Nola project takes: `.tsi` files hold the infer
functions, a plain `.ts` entry point calls them, and `nola run` executes the
entry with the loader and `nola.config.ts` in place.

```
my-app/
  nola.config.ts        # providers
  package.json          # nola-lang in devDependencies
  tsconfig.json         # include: ["src"]
  src/
    person.tsi          # the Nola source
    main.ts             # a plain TypeScript consumer
```

`src/person.tsi` — the type and the infer function live together:

```tsi
export interface Person {
  name: string;
  age: number;
  employer: string;
  job: string;
}

export infer function extractPerson(.message: string) {
  const person = ask ..`the person described in the text`<Person>;
  return person;
}
```

`src/main.ts` — plain TypeScript. Note the literal `.tsi` extension in the
import, and that `await` on the returned `Intent` is what runs the inference:

```ts
import { extractPerson } from "./person.tsi";

const person = await extractPerson(
  "Alice Smith, 32, is a staff engineer at Acme Corp working on distributed systems.",
);
console.log(JSON.stringify(person));
```

Run it:

```bash
nola run src/main.ts        # or: npm start
nola check                  # type-checks .tsi and .ts together
nola build                  # dist/ — plain JS + source maps + .d.ts
```

## Composing several asks in one invocation

Every `ask` in one invocation shares that invocation's context — the `..`
contextual parameters and the function's instruction marker. That is what lets
you split one big prompt into several small, individually-typed asks instead of
demanding everything at once.

What is NOT shared is the answers. Earlier results are recorded on the
invocation's frame, but history does not compose into later prompts yet: a
later ask does NOT see what an earlier ask returned. When it needs an earlier
answer, pass it forward explicitly with `${}` interpolation.

```tsi
export infer function solve(.problem: string) {
  // Both asks see `problem` (the contextual parameter). They do NOT see each
  // other's answers automatically — the reasoning is handed to the second ask
  // explicitly through `${}`.
  const reasoning = ask ..`think step by step about the problem before answering`;
  const answer = ask ..`the final numeric answer, given this reasoning: ${reasoning}`<number>;
  return { reasoning, answer };
}
```

Once an `ask` returns, its result is an ORDINARY typed value — branch on it,
pass it to plain functions, put it in an object literal, interpolate it into a
later prompt:

```tsi
export type Category = "billing" | "refund" | "fraud" | "other";

export infer function classifyMessage(.message: string) {
  const category = ask ..`the category of the customer message`<Category>;
  const urgent = ask ..`does the message need urgent attention`<"yes" | "no">;

  // plain TS from here on
  if (category === "fraud") return { category, urgent: true, escalate: true };
  return { category, urgent: urgent === "yes", escalate: false };
}
```

Plain TypeScript orchestrates the loop; the infer functions stay small:

```tsi
// src/research.tsi
export interface Conclusion {
  answer: string;
  /** the collected notes that directly support the answer */
  evidence: string[];
}

export infer function nextQuery(.question: string, .notes: string[]) {
  return ask ..`the single best search query to advance the research; keywords only`<string>;
}

export infer function conclude(.question: string, .notes: string[]) {
  return ask ..`answer the research question using only the collected notes`<Conclusion>;
}
```

```ts
// src/main.ts
import { conclude, nextQuery } from "./research.tsi";
import { search } from "./search.js";

const question = "who maintains the project?";
const notes: string[] = [];
for (let i = 0; i < 3; i++) {
  const query = await nextQuery(question, notes);
  notes.push(await search(query));
}
const conclusion = await conclude(question, notes);
```

## Call intents — let the LLM fill a function's arguments

When you already have a function that DOES something, do not extract its
arguments one at a time and then call it. Make the call itself the intent: the
LLM fills every extractor-shaped argument in one provider call, and the
function runs with the results.

`src/tickets.ts` — an ordinary TypeScript helper, nothing Nola about it:

```ts
export async function createTicket(title: string, priority: number): Promise<string> {
  const res = await fetch("https://example.test/tickets", {
    method: "POST",
    body: JSON.stringify({ title, priority }),
  });
  return (await res.json()).id as string;
}
```

`src/file-ticket.tsi` — the helper is imported with the NodeNext `.js`
specifier, and the call gets extractor arguments:

```tsi
import { createTicket } from "./tickets.js";

export infer function fileTicket(.request: string) {
  // Sigil-less: the extractor argument makes this call an intent. `2` is a
  // plain argument and is passed through untouched.
  const id = ask createTicket(..`a short ticket title for the request`<string>, 2);
  return id;
}
```

Add instruction text for the call with the marker form — it is the only
spelling that carries a hint:

```tsi
export infer function fileTicketCarefully(.request: string) {
  return ask createTicket`file the ticket exactly as the customer described it`(
    ..`a short ticket title`<string>,
    ..`priority 1-5, where 1 is most urgent`<number>,
  );
}
```

Every extractor slot needs an explicit `<T>`, and all slots of one call
resolve together in a single provider round trip.

`createTicket` is async, but `id` is a `string`, not a `Promise<string>` — a
call intent awaits a promise-returning callee itself (`ask` ≈ `await`), so
`await ask createTicket(...)` is redundant. Because the callee runs inside the
ask, `.withRetry(n)` on a call intent re-invokes it on failure — only use it
when the target is idempotent.

## Typing the answers

Prefer a NAMED, exported `type` or `interface` for `<T>` over an inline object
literal: it documents the contract, it is reusable from plain TS, and JSDoc
comments on its members become descriptions in the schema the LLM sees.

```tsi
export interface LineItem {
  description: string;
  quantity: number;
  /** price per unit in USD */
  unitPrice: number;
}

export interface Invoice {
  invoiceNumber: string;
  issuedTo: string;
  lineItems: LineItem[];
  /** grand total in USD */
  total: number;
  /** ISO date; omit when the document has none */
  dueDate?: string;
}

export infer function extractInvoice(.document: string) {
  return ask ..`the invoice data from the document`<Invoice>;
}
```

Closed label sets keep the model on-rails — a string-literal union, a string
enum, or an inline union all work:

```tsi
export type Category = "billing" | "refund" | "fraud" | "other";

export enum Sentiment {
  Positive = "positive",
  Neutral = "neutral",
  Negative = "negative",
}

export infer function triage(.message: string) {
  const category = ask ..`the category of the customer message`<Category>;
  const sentiment = ask ..`the overall sentiment of the message`<Sentiment>;
  const urgent = ask ..`does the message need urgent attention`<"yes" | "no">;
  return { category, sentiment, urgent: urgent === "yes" };
}
```

### Types from another file

Cross-file types are supported. Import the type from a plain `.ts` file with a
type-only import and the NodeNext `.js` specifier; the toolchain derives the
schema for you:

```ts
// src/models.ts
export interface Person {
  name: string;
  age: number;
}
```

```tsi
// src/report.tsi
import type { Person } from "./models.js";

export infer function extractPerson(.text: string) {
  return ask ..`the person described in the text`<Person>;
}
```

Recursive types are legal too:

```tsi
export type TreeNode = {
  label: string;
  children?: TreeNode[];
};

export infer function parseTree(.input: string) {
  return ask ..`the tree structure described in the input`<TreeNode>;
}
```

`Date` fields work and come back as real `Date` instances:

```tsi
export type CalendarEvent = { title: string; at: Date };

export infer function nextEvent(.calendar: string) {
  const event = ask ..`the next event on the calendar`<CalendarEvent>;
  const when: Date = event.at;   // a Date, not a string
  return when;
}
```
