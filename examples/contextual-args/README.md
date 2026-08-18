# contextual-args

Demonstrates `.param` contextual parameters (the argument value joins the LM
context for every `ask` in the function scope, while plain parameters
contribute only their name and type) and the `system: { message }` config key
(extra system-prompt text composed after the Nola protocol preamble).

```bash
nola run src/main.ts
```
