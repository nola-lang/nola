import type { LanguageModel } from "@nola-lang/core";
import { joinBlocks, NolaProviderError, parseRetryAfter } from "@nola-lang/core";
import { questionsFor } from "./typesafe-questions.js";

export interface TypesafeOptions {
  apiKey?: string;
  /** Env var name holding the key. Default: "TYPESAFE_API_KEY". Value is read lazily at the first request. */
  apiKeyEnv?: string;
  /** Default: "jev-latest" — this vendor ships one model, so a bare `typesafe()` is the documented form. */
  model?: string;
  /** Default: "https://api.typesafe.ai" */
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

const DEFAULT_MODEL = "jev-latest";
const DEFAULT_BASE_URL = "https://api.typesafe.ai";

/**
 * typesafe.ai's System One API (model Jev): not a chat model. One request
 * answers named choice / noul questions about a `state`, so this factory
 * serves exactly the asks whose output type is literal unions and
 * booleans (see `questionsFor`) and fails definitively — before the
 * network — on anything else, which is what lets `fallback([typesafe(),
 * openai("…")])` escalate. A bare string is shorthand for `{ model }`.
 */
export function typesafe(optionsOrModel?: TypesafeOptions | string): LanguageModel {
  const options: TypesafeOptions = typeof optionsOrModel === "string" ? { model: optionsOrModel } : (optionsOrModel ?? {});
  const doFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = options.model ?? DEFAULT_MODEL;
  return {
    name: "typesafe",
    async complete(req) {
      const requestedAt = Date.now();
      const envName = options.apiKeyEnv ?? "TYPESAFE_API_KEY";
      const apiKey = options.apiKey ?? process.env[envName];
      if (!apiKey) {
        throw new NolaProviderError(
          `TypeSafe API key not found: environment variable ${envName} is not set (checked process.env, including the project .env applied by the Nola loader) and no \`apiKey\` was passed to typesafe(). Fix: set ${envName}, or pass typesafe({ apiKeyEnv: "MY_VAR" }) or typesafe({ apiKey }) in nola.config.ts.`,
          { definitive: true },
        );
      }
      const { system, messages, output } = req.payload;
      const mapped = questionsFor(output.syntax === "json" ? output.schema : undefined);
      if (!mapped.ok) {
        throw new NolaProviderError(`TypeSafe cannot serve this ask: ${mapped.reason}`, { definitive: true });
      }
      const { plan } = mapped;
      // Jev has no conversation: the state is the rendering's system text and
      // its first user turn. A correction turn cannot occur in practice (the
      // synthesized reply is schema-valid by construction), so any further
      // messages are ignored and the ask is re-answered from the first turn.
      const state = joinBlocks(system, messages[0]?.content ?? "");
      const res = await doFetch(`${baseUrl}/v1/systemone`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, state, questions: plan.questions }),
        signal: req.signal ?? null,
      });
      if (!res.ok) {
        const errorBody = await res.text();
        throw new NolaProviderError(
          `TypeSafe request failed: ${res.status} ${res.statusText} — ${errorBody.slice(0, 500)}`,
          { status: res.status, retryAfterMs: parseRetryAfter(res.headers.get("retry-after")) },
        );
      }
      let data: { answers?: unknown };
      try {
        data = (await res.json()) as { answers?: unknown };
      } catch (e) {
        throw new NolaProviderError("TypeSafe reply is not JSON.", { definitive: true, cause: e });
      }
      const answers = data.answers;
      if (answers === null || typeof answers !== "object" || Array.isArray(answers)) {
        throw new NolaProviderError("TypeSafe reply is malformed: no answers object", { definitive: true });
      }
      const value: Record<string, unknown> = {};
      for (const [key, decode] of Object.entries(plan.decode)) {
        const decoded = decode((answers as Record<string, unknown>)[key]);
        if (!decoded.ok) throw new NolaProviderError(`TypeSafe reply is malformed: ${decoded.reason}`, { definitive: true });
        value[key] = decoded.value;
      }
      const durationMs = Date.now() - requestedAt;
      return { text: JSON.stringify(plan.scalar ? value.value : value), durationMs };
    },
  };
}
