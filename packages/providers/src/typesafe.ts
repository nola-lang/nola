import type { InferRequest, LanguageModel } from "@nola-lang/core";
import { DECISION_MODEL, NolaProviderError, parseRetryAfter } from "@nola-lang/core";
import { planFor } from "./decisions.js";

export interface TypesafeOptions {
  apiKey?: string;
  /** Env var name holding the key. Default: "TYPESAFE_API_KEY". Value is read lazily at the first request. */
  apiKeyEnv?: string;
  /** Default: "jev-latest" — this vendor ships one model, so a bare `typesafe()` is the documented form. */
  model?: string;
  /** Default: "https://api.typesafe.ai" */
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  /**
   * A plain `boolean` is `true` when the probability of yes is STRICTLY above
   * this (default 0.5, so a coin flip is `false`). `params.providerOptions.threshold`
   * on an ask overrides it (the `.withParams` channel — no new syntax).
   */
  threshold?: number;
}

const DEFAULT_MODEL = "jev-latest";
const DEFAULT_BASE_URL = "https://api.typesafe.ai";
const DEFAULT_THRESHOLD = 0.5;

/**
 * typesafe.ai's System One API (model Jev): not a chat model. One request
 * answers named choice / score / noul questions about a JSON `state`, so this
 * factory is an INFER-dialect decision model (spec 2026-09-18 §6.2): it
 * receives the InferenceModel, sends the contextual values as the state and
 * each property's JSDoc as its question (through the shared `planFor`), serves
 * `Choice` / `Scale` / `Prob` natively beside literal unions and booleans, and
 * fails definitively — before the network — on anything else, which is what
 * lets `fallback([typesafe(), openai("…")])` escalate. A bare string is
 * shorthand for `{ model }`.
 *
 * UNVERIFIED against the live API (no key at implementation time): option
 * labels with spaces/punctuation as `criteria` keys, and the structured
 * `instructions` object. If the API rejects either, the change is confined to
 * `decisions.ts` (`opt_<n>` keys with a decoder map; a joined string).
 */
export function typesafe(optionsOrModel?: TypesafeOptions | string): LanguageModel {
  const options: TypesafeOptions =
    typeof optionsOrModel === "string" ? { model: optionsOrModel } : (optionsOrModel ?? {});
  const doFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = options.model ?? DEFAULT_MODEL;
  return {
    ...{ [DECISION_MODEL]: true as const },
    name: "typesafe",
    async infer(req: InferRequest) {
      const requestedAt = Date.now();
      const envName = options.apiKeyEnv ?? "TYPESAFE_API_KEY";
      const apiKey = options.apiKey ?? process.env[envName];
      if (!apiKey) {
        throw new NolaProviderError(
          `TypeSafe API key not found: environment variable ${envName} is not set (checked process.env, including the project .env applied by the Nola loader) and no \`apiKey\` was passed to typesafe(). Fix: set ${envName}, or pass typesafe({ apiKeyEnv: "MY_VAR" }) or typesafe({ apiKey }) in nola.config.ts.`,
          { definitive: true },
        );
      }
      const askThreshold = (req.params?.providerOptions as { threshold?: unknown } | undefined)?.threshold;
      const threshold = typeof askThreshold === "number" ? askThreshold : (options.threshold ?? DEFAULT_THRESHOLD);
      // Jev has no conversation: a correction turn (req.model.correction) has
      // nothing to say to it, so the ask is re-answered from the same state.
      const mapped = planFor(req.model, { threshold });
      if (!mapped.ok) {
        throw new NolaProviderError(`TypeSafe cannot serve this ask: ${mapped.reason}`, { definitive: true });
      }
      const { plan } = mapped;
      const res = await doFetch(`${baseUrl}/v1/systemone`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, state: plan.state, questions: plan.questions }),
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
        if (!decoded.ok) {
          throw new NolaProviderError(`TypeSafe reply is malformed: ${decoded.reason}`, { definitive: true });
        }
        value[key] = decoded.value;
      }
      const durationMs = Date.now() - requestedAt;
      return { text: JSON.stringify(plan.scalar ? value.value : value), durationMs };
    },
  };
}
