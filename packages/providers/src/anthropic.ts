import type { JsonSchema, NolaProvider } from "@nola-lang/core";
import { NolaProviderError } from "@nola-lang/core";
import { ENVELOPE_NOTE, envelope, parseRetryAfter, resolveRootRef } from "./wire.js";

export interface AnthropicOptions {
  apiKey?: string;
  /** Env var name holding the key. Default: "ANTHROPIC_API_KEY". Value is read lazily at the first request. */
  apiKeyEnv?: string;
  /** Required — there is no default model; every config names its own. */
  model: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  /** The Messages API requires max_tokens on every request. Default: 4096. */
  maxOutputTokens?: number;
}

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

/** A bare model string is shorthand for `{ model }` — every other option defaulted. */
export function anthropic(optionsOrModel: AnthropicOptions | string): NolaProvider {
  const options = typeof optionsOrModel === "string" ? { model: optionsOrModel } : optionsOrModel;
  const doFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
  const model = options.model;
  const maxTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  return {
    name: "anthropic",
    async complete(req) {
      const requestedAt = Date.now();
      const envName = options.apiKeyEnv ?? "ANTHROPIC_API_KEY";
      const apiKey = options.apiKey ?? process.env[envName];
      if (!apiKey) {
        throw new NolaProviderError(
          `Anthropic API key not found: environment variable ${envName} is not set (checked process.env, including the project .env applied by the Nola loader) and no \`apiKey\` was passed to anthropic(). Fix: set ${envName}, or pass anthropic({ apiKeyEnv: "MY_VAR" }) or anthropic({ apiKey }) in nola.config.ts.`,
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
        model,
        max_tokens: maxTokens,
        system,
        messages: req.messages,
      };
      if (transport) {
        body.output_config = { format: { type: "json_schema", schema: transport } };
      }
      const res = await doFetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(body),
        signal: req.signal ?? null,
      });
      if (!res.ok) {
        const errorBody = await res.text();
        throw new NolaProviderError(
          `Anthropic request failed: ${res.status} ${res.statusText} — ${errorBody.slice(0, 500)}`,
          {
            status: res.status,
            retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
          },
        );
      }
      const data = (await res.json()) as { content?: Array<{ type?: unknown; text?: unknown }> };
      const textBlock = data.content?.find((block) => block.type === "text" && typeof block.text === "string");
      if (!textBlock) throw new NolaProviderError("Anthropic response had no text content.");
      const content = textBlock.text as string;
      const durationMs = Date.now() - requestedAt;
      if (!reqSchema) return { text: content, durationMs };
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        throw new NolaProviderError("Anthropic returned non-JSON despite structured outputs.", { cause: e });
      }
      const value = enveloped ? (parsed as { value?: unknown }).value : parsed;
      return { text: JSON.stringify(value), durationMs };
    },
  };
}
