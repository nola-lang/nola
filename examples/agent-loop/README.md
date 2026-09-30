# agent-loop

An agent loop in one `.tsi` file: the model works through a customer's message
one problem at a time until it answers `null`. The whole program is
`src/main.tsi` — a module-level context statement, a `const .query` binding
that holds the message, a top-level `while` loop with an `ask` inside it, and
a context statement the loop reads again on every pass:

```tsi
`Problems recorded so far:` problems.map((p) => p.brief)
`Never report one of them again.`;
```

Text, then a value, then more text: a line that starts with a backtick
continues the statement, and the line break stays in the prompt. The
statement stands before the loop, and every ask inside the loop sees the list
as it is on that pass — no re-prompting code and no prompt string rebuilt by
hand. The ask is typed with the colon spelling, `Problem | null`, so `null`
is a legal, validated answer the loop can break on.

The second context statement, inside the loop body, is scoped like a `const`
declared there: only the asks inside the braces see it, and nothing after the
loop does. Context statements never pile up across passes — each ask sees
every statement visible at its position exactly once, rendered at that ask,
however many times the loop has run. What changes between passes is the value
the first statement reads (`problems`), not the set of statements.

```sh
npx nola-lang run src/main.tsi                     # mock provider (deterministic)
# real provider: edit nola.config.ts to openai({ model: "gpt-5-mini" }) (needs OPENAI_API_KEY)
```
