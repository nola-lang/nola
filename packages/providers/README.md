# @nola-lang/providers

Everything provider-shaped in [Nola](https://github.com/nola-lang/nola):
provider factories, resilience combinators, and record/replay.

```ts
import { defineConfig } from "@nola-lang/runtime";
import { anthropic, google, openai, mockProvider, withRetry, exponential, fallback, record, replay } from "@nola-lang/providers";

export default defineConfig({
  providers: {
    default: withRetry(anthropic("claude-sonnet-5"), exponential({ maxRetries: 3 })),
    fast: fallback([google("gemini-2.5-flash"), openai("gpt-5-mini")]),
    test: replay("./nola.replay.jsonl"),   // record(...) once, replay offline forever
  },
});
```

A bare model string is shorthand for `{ model }` — `openai("gpt-5-mini")` is
`openai({ model: "gpt-5-mini" })` with every other option defaulted; pass the
object form when you need `apiKey`/`apiKeyEnv`, `baseUrl`, or an injected `fetch`.

Every factory reads its API key lazily at the first request — `openai()` from
`OPENAI_API_KEY`, `anthropic()` from `ANTHROPIC_API_KEY`, `google()` from
`GEMINI_API_KEY` — overridable per provider with `apiKeyEnv: "MY_VAR"` or an
inline `apiKey`. All take an injectable `fetch`.
`mockProvider([...])` gives deterministic, network-free answers for tests.

## OpenAI-compatible endpoints

Any service that speaks the Chat Completions dialect works through
`openai({ baseUrl })` — no dedicated factory needed:

```ts
// Ollama (local; the key is required by the dialect but ignored by the server)
openai({ baseUrl: "http://localhost:11434/v1", apiKey: "ollama", model: "llama3.2" })

// OpenRouter (one key, every model)
openai({ baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY", model: "deepseek/deepseek-chat" })

// Groq
openai({ baseUrl: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY", model: "llama-3.3-70b-versatile" })

// DeepSeek
openai({ baseUrl: "https://api.deepseek.com/v1", apiKeyEnv: "DEEPSEEK_API_KEY", model: "deepseek-chat" })

// xAI
openai({ baseUrl: "https://api.x.ai/v1", apiKeyEnv: "XAI_API_KEY", model: "grok-4" })
```

Structured output degrades gracefully on generate-then-validate backends:
`openai()` recovers the model's answer from Groq-style `json_validate_failed`
errors, and the JSON contract is always re-validated Nola-side regardless of
what the backend enforced.
