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

export interface GoogleOptions {
  apiKey?: string;
  /** Env var name holding the key. Default: "GEMINI_API_KEY". Value is read lazily at the first request. */
  apiKeyEnv?: string;
  /** Required — there is no default model; every config names its own. */
  model: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  /**
   * Default true: the schema rides the API's structured-output field. false:
   * nothing is sent on the wire and the schema is rendered into the system
   * turn as a <schema> block — for a proxy or server that cannot enforce it.
   */
  structuredOutputs?: boolean;
  /**
   * The tool-use strategy for a tool-use ask (`` ask `task` [fn]: T ``).
   * Default "native": generateContent's function calling, one call per turn,
   * the loop in Nola. false: this endpoint offers no function calling — the
   * model is unbranded, a tool-use ask over it is NOLA3019 before the
   * network, and a `fallback` group skips it for tool-use asks.
   */
  toolUse?: ToolUseMode | false;
}

/**
 * The conversation with the transcript in generateContent form: the task
 * turn, then per tool turn a model content of text and `functionCall` parts
 * and a user content of `functionResponse` parts answered by name, then the
 * correction pair when one ran.
 */
function nativeContents(
  intent: InferRequest["intent"],
  toText: (m: { role: string; content: string }) => unknown,
): unknown[] {
  const { task, tail } = splitMessages(intent);
  const turns: unknown[] = [];
  for (const turn of transcriptTurns(intent)) {
    turns.push({
      role: "model",
      parts: [
        ...(turn.text !== undefined && turn.text !== "" ? [{ text: turn.text }] : []),
        ...turn.calls.map((c) => ({ functionCall: { name: c.name, args: c.args } })),
      ],
    });
    turns.push({ role: "user", parts: turn.calls.map((c) => ({ functionResponse: { name: c.name, response: { result: c.result } } })) });
  }
  return [toText(task), ...turns, ...tail.map(toText)];
}

/** A bare model string is shorthand for `{ model }` — every other option defaulted. */
export function google(optionsOrModel: GoogleOptions | string): LanguageModel {
  const options = typeof optionsOrModel === "string" ? { model: optionsOrModel } : optionsOrModel;
  const doFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  const model = options.model;
  return {
    // tool use (spec 2026-10-08): generateContent takes function declarations natively, unless `toolUse: false`
    ...toolUseBrand("google", options.toolUse),
    name: "google",
    async infer(req: InferRequest) {
      const requestedAt = Date.now();
      const envName = options.apiKeyEnv ?? "GEMINI_API_KEY";
      const apiKey = options.apiKey ?? readEnv(envName);
      // A custom `fetch` owns authentication (a relay, a proxy, a test): no key is needed and no
      // vendor header is sent without one. Without a custom fetch the key is required, as before.
      if (!apiKey && !options.fetch) {
        throw new NolaProviderError(
          `Google API key not found: environment variable ${envName} is not set (checked process.env, including the project .env applied by the Nola loader) and no \`apiKey\` was passed to google(). Fix: set ${envName}, or pass google({ apiKeyEnv: "MY_VAR" }) or google({ apiKey }) in nola.config.ts.`,
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
      const toText = (m: { role: string; content: string }) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] });
      const body: Record<string, unknown> = {
        system_instruction: { parts: [{ text: system }] },
        contents: tools.length > 0 ? nativeContents(req.intent, toText) : messages.map(toText),
      };
      if (tools.length > 0) {
        // Function calling does not mix with JSON response mode: the answer is
        // one more function carrying the output schema, and mode ANY makes
        // every turn a call — a real function continues the loop, the answer
        // function ends it. Without enforcement the model answers in text.
        const answerFn = transport && enforce ? [{ name: ANSWER_TOOL, description: ANSWER_TOOL_DESCRIPTION, parametersJsonSchema: transport }] : [];
        body.tools = [
          {
            functionDeclarations: [
              ...tools.map((t) => ({
                name: t.name,
                ...(t.description !== undefined ? { description: t.description } : {}),
                parametersJsonSchema: t.parameters,
              })),
              ...answerFn,
            ],
          },
        ];
        body.toolConfig = { functionCallingConfig: { mode: answerFn.length > 0 ? "ANY" : "AUTO" } };
      } else if (transport && enforce) {
        body.generationConfig = { responseMimeType: "application/json", responseJsonSchema: transport };
      }
      const res = await doFetch(`${baseUrl}/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(apiKey ? { "x-goog-api-key": apiKey } : {}) },
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
        candidates?: Array<{ content?: { parts?: Array<{ text?: unknown; functionCall?: { id?: unknown; name?: unknown; args?: unknown } }> } }>;
      };
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const part = parts.find((p) => typeof p.text === "string");
      const durationMs = Date.now() - requestedAt;
      if (tools.length > 0) {
        // Gemini's calls carry no id (newer models may): mint one per call, answered by name
        const calls: ToolCall[] = parts
          .filter((p) => typeof p.functionCall?.name === "string")
          .map((p, i) => ({
            id: typeof p.functionCall?.id === "string" ? p.functionCall.id : `fc_${i + 1}`,
            name: p.functionCall?.name as string,
            args: p.functionCall?.args ?? {},
          }));
        const { answer, tools: toolCalls } = partitionCalls(calls);
        if (toolCalls.length > 0) return { text: typeof part?.text === "string" ? part.text : "", toolCalls, durationMs, sent };
        if (answer) return { text: answerFromTool(answer.args, enveloped), durationMs, sent };
      }
      if (!part) throw new NolaProviderError("Google response had no candidate text.");
      const content = part.text as string;
      if (!reqSchema) return { text: content, durationMs, sent };
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        throw new NolaProviderError("Google returned non-JSON despite structured output.", { cause: e });
      }
      const value = enveloped ? (parsed as { value?: unknown }).value : parsed;
      return { text: JSON.stringify(value), durationMs, sent };
    },
  };
}
