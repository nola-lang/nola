import type { JsonSchema, NolaProvider } from "@nola-lang/core";
import { NolaProviderError } from "@nola-lang/core";
import { ENVELOPE_NOTE, envelope, parseRetryAfter, resolveRootRef } from "./wire.js";

export interface GoogleOptions {
  apiKey?: string;
  /** Env var name holding the key. Default: "GEMINI_API_KEY". Value is read lazily at the first request. */
  apiKeyEnv?: string;
  /** Required — there is no default model; every config names its own. */
  model: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

/** A bare model string is shorthand for `{ model }` — every other option defaulted. */
export function google(optionsOrModel: GoogleOptions | string): NolaProvider {
  const options = typeof optionsOrModel === "string" ? { model: optionsOrModel } : optionsOrModel;
  const doFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  const model = options.model;
  return {
    name: "google",
    async complete(req) {
      const requestedAt = Date.now();
      const envName = options.apiKeyEnv ?? "GEMINI_API_KEY";
      const apiKey = options.apiKey ?? process.env[envName];
      if (!apiKey) {
        throw new NolaProviderError(
          `Google API key not found: environment variable ${envName} is not set (checked process.env, including the project .env applied by the Nola loader) and no \`apiKey\` was passed to google(). Fix: set ${envName}, or pass google({ apiKeyEnv: "MY_VAR" }) or google({ apiKey }) in nola.config.ts.`,
          { definitive: true },
        );
      }
      const reqSchema = req.output.syntax === "json" ? req.output.schema : undefined;
      const rootShape = reqSchema === undefined ? undefined : resolveRootRef(reqSchema);
      const enveloped = rootShape !== undefined && !("$ref" in rootShape) && rootShape.type !== "object";
      const transport: JsonSchema | undefined =
        reqSchema === undefined ? undefined : enveloped ? envelope(reqSchema) : reqSchema;
      const system = enveloped ? req.system + ENVELOPE_NOTE : req.system;
      const body: Record<string, unknown> = {
        system_instruction: { parts: [{ text: system }] },
        contents: req.messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
      };
      if (transport) {
        body.generationConfig = { responseMimeType: "application/json", responseJsonSchema: transport };
      }
      const res = await doFetch(`${baseUrl}/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal: req.signal ?? null,
      });
      if (!res.ok) {
        const errorBody = await res.text();
        throw new NolaProviderError(
          `Google request failed: ${res.status} ${res.statusText} — ${errorBody.slice(0, 500)}`,
          {
            status: res.status,
            retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
          },
        );
      }
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
      };
      const part = data.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === "string");
      if (!part) throw new NolaProviderError("Google response had no candidate text.");
      const content = part.text as string;
      const durationMs = Date.now() - requestedAt;
      if (!reqSchema) return { text: content, durationMs };
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        throw new NolaProviderError("Google returned non-JSON despite structured output.", { cause: e });
      }
      const value = enveloped ? (parsed as { value?: unknown }).value : parsed;
      return { text: JSON.stringify(value), durationMs };
    },
  };
}
