import type { InferRequest, JsonSchema, LanguageModel, RenderedPrompt, ToolCall, ToolUseMode } from "@nola-lang/core";
import { NolaProviderError, parseRetryAfter, readEnv, renderPrompt } from "@nola-lang/core";
import {
  ANSWER_TOOL,
  ANSWER_TOOL_DESCRIPTION,
  answerFromTool,
  partitionCalls,
  splitMessages,
  toolUseBrand,
  transcriptTurns,
  wireTools,
} from "./tools.js";
import { ENVELOPE_NOTE, envelope, resolveRootRef, schemaNote } from "./wire.js";

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
  /**
   * Default true: the schema rides the API's structured-output field. false:
   * nothing is sent on the wire and the schema is rendered into the system
   * turn as a <schema> block — for a proxy or server that cannot enforce it.
   */
  structuredOutputs?: boolean;
  /**
   * The tool-use strategy for a tool-use ask (`` ask `task` [fn]: T ``).
   * Default "native": the Messages API's tool use, one call per turn, the
   * loop in Nola. false: this endpoint offers no tool use — the model is
   * unbranded, a tool-use ask over it is NOLA3019 before the network, and a
   * `fallback` group skips it for tool-use asks.
   */
  toolUse?: ToolUseMode | false;
}

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

/**
 * The conversation with the transcript in Messages form: the task turn, then
 * per tool turn an assistant message of text and `tool_use` blocks and a user
 * message of `tool_result` blocks, then the correction pair when one ran.
 */
function nativeMessages(intent: InferRequest["intent"]): unknown[] {
  const { task, tail } = splitMessages(intent);
  const turns: unknown[] = [];
  for (const turn of transcriptTurns(intent)) {
    turns.push({
      role: "assistant",
      content: [
        ...(turn.text !== undefined && turn.text !== "" ? [{ type: "text", text: turn.text }] : []),
        ...turn.calls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.args })),
      ],
    });
    turns.push({ role: "user", content: turn.calls.map((c) => ({ type: "tool_result", tool_use_id: c.id, content: c.result })) });
  }
  return [task, ...turns, ...tail];
}

/** A bare model string is shorthand for `{ model }` — every other option defaulted. */
export function anthropic(optionsOrModel: AnthropicOptions | string): LanguageModel {
  const options = typeof optionsOrModel === "string" ? { model: optionsOrModel } : optionsOrModel;
  const doFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
  const model = options.model;
  const maxTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  return {
    // tool use (spec 2026-10-08): the Messages API takes tools natively, unless `toolUse: false`
    ...toolUseBrand("anthropic", options.toolUse),
    name: "anthropic",
    async infer(req: InferRequest) {
      const requestedAt = Date.now();
      const envName = options.apiKeyEnv ?? "ANTHROPIC_API_KEY";
      const apiKey = options.apiKey ?? readEnv(envName);
      // A custom `fetch` owns authentication (a relay, a proxy, a test): no key is needed and no
      // vendor header is sent without one. Without a custom fetch the key is required, as before.
      if (!apiKey && !options.fetch) {
        throw new NolaProviderError(
          `Anthropic API key not found: environment variable ${envName} is not set (checked process.env, including the project .env applied by the Nola loader) and no \`apiKey\` was passed to anthropic(). Fix: set ${envName}, or pass anthropic({ apiKeyEnv: "MY_VAR" }) or anthropic({ apiKey }) in nola.config.ts.`,
          { definitive: true },
        );
      }
      const { system: baseSystem, messages } = renderPrompt(req.intent);
      const output = req.intent.output;
      const reqSchema = output.syntax === "json" ? output.schema : undefined;
      const rootShape = reqSchema === undefined ? undefined : resolveRootRef(reqSchema);
      const enveloped = rootShape !== undefined && !("$ref" in rootShape) && !("type" in rootShape && rootShape.type === "object");
      const transport: JsonSchema | undefined =
        reqSchema === undefined ? undefined : enveloped ? envelope(reqSchema) : reqSchema;
      // structuredOutputs: false — the schema goes into the system turn instead of the wire field
      const enforce = options.structuredOutputs !== false;
      const system = (enveloped ? baseSystem + ENVELOPE_NOTE : baseSystem) + (!enforce && transport ? schemaNote(transport) : "");
      const sent: RenderedPrompt = { system, messages };
      const tools = wireTools(req.intent);
      const body: Record<string, unknown> = {
        model,
        max_tokens: maxTokens,
        system,
        messages: tools.length > 0 ? nativeMessages(req.intent) : messages,
      };
      if (tools.length > 0) {
        // The Messages API does not mix its structured output with tools: the
        // answer is one more tool carrying the output schema, and tool_choice
        // `any` makes every turn a tool call — a real tool continues the loop,
        // the answer tool ends it. Without enforcement the model answers in text.
        const answerTool = transport && enforce ? [{ name: ANSWER_TOOL, description: ANSWER_TOOL_DESCRIPTION, input_schema: transport }] : [];
        body.tools = [
          ...tools.map((t) => ({ name: t.name, ...(t.description !== undefined ? { description: t.description } : {}), input_schema: t.parameters })),
          ...answerTool,
        ];
        body.tool_choice = { type: answerTool.length > 0 ? "any" : "auto" };
      } else if (transport && enforce) {
        body.output_config = { format: { type: "json_schema", schema: transport } };
      }
      const res = await doFetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(apiKey ? { "x-api-key": apiKey } : {}), "anthropic-version": "2023-06-01" },
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
      const data = (await res.json()) as {
        content?: Array<{ type?: unknown; text?: unknown; id?: unknown; name?: unknown; input?: unknown }>;
      };
      const blocks = data.content ?? [];
      const textBlock = blocks.find((block) => block.type === "text" && typeof block.text === "string");
      const durationMs = Date.now() - requestedAt;
      if (tools.length > 0) {
        const calls: ToolCall[] = blocks
          .filter((b) => b.type === "tool_use" && typeof b.name === "string")
          .map((b, i) => ({ id: typeof b.id === "string" ? b.id : `toolu_${i + 1}`, name: b.name as string, args: b.input }));
        const { answer, tools: toolCalls } = partitionCalls(calls);
        if (toolCalls.length > 0) {
          return { text: typeof textBlock?.text === "string" ? textBlock.text : "", toolCalls, durationMs, sent };
        }
        if (answer) return { text: answerFromTool(answer.args, enveloped), durationMs, sent };
      }
      if (!textBlock) throw new NolaProviderError("Anthropic response had no text content.");
      const content = textBlock.text as string;
      if (!reqSchema) return { text: content, durationMs, sent };
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        throw new NolaProviderError("Anthropic returned non-JSON despite structured outputs.", { cause: e });
      }
      const value = enveloped ? (parsed as { value?: unknown }).value : parsed;
      return { text: JSON.stringify(value), durationMs, sent };
    },
  };
}
