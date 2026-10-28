import type { InferRequest, LanguageModel, RenderedPrompt } from "@nola-lang/core";
import { DECISION_MODEL, renderPrompt, TOOL_MODEL } from "@nola-lang/core";

/** What a mock callback sees: the intent, plus its default rendering on demand. */
export type MockRequest = InferRequest & { readonly prompt: RenderedPrompt };

export interface MockOptions {
  /**
   * Brand the mock a decision model (decision types spec 2026-09-18 §6.1): a
   * test routing a Choice / Scale / Prob ask through a mock says so
   * explicitly — without it the runtime refuses, as it would for any
   * unbranded model.
   */
  decisions?: boolean;
  /**
   * Brand the mock a tool model (tool-use spec 2026-10-08 §3.6): a test
   * routing a tool-use ask through a mock says so explicitly; a `toolCalls`
   * value then scripts a tool turn.
   */
  tools?: boolean;
}

const MOCK_TOOL_CALLS: unique symbol = Symbol("nola.mock.toolCalls");

/** A scripted tool turn — what `toolCalls([...])` returns; the mock answers it as `InferResult.toolCalls`. */
export interface MockToolCalls {
  readonly [MOCK_TOOL_CALLS]: true;
  readonly calls: ReadonlyArray<{ id?: string; name: string; args: unknown }>;
}

/** A tool turn for a mock's queue or callback: the model requests these calls (ids minted when absent) instead of answering. */
export function toolCalls(calls: ReadonlyArray<{ id?: string; name: string; args: unknown }>): MockToolCalls {
  return { [MOCK_TOOL_CALLS]: true, calls };
}

const isMockToolCalls = (v: unknown): v is MockToolCalls =>
  typeof v === "object" && v !== null && (v as { [MOCK_TOOL_CALLS]?: unknown })[MOCK_TOOL_CALLS] === true;

/** The request with a memoized `prompt` getter — rendered only when a callback reads it. */
function withPrompt(req: InferRequest): MockRequest {
  let rendered: RenderedPrompt | undefined;
  return Object.defineProperty({ ...req }, "prompt", {
    enumerable: false,
    get: () => (rendered ??= renderPrompt(req.intent)),
  }) as MockRequest;
}

export function mockProvider(
  source: unknown[] | ((req: MockRequest) => unknown),
  options: MockOptions = {},
): LanguageModel {
  const queue = Array.isArray(source) ? [...source] : null;
  let minted = 0;
  return {
    ...(options.decisions ? { [DECISION_MODEL]: true } : {}),
    ...(options.tools ? { [TOOL_MODEL]: true } : {}),
    name: "mock",
    async infer(req) {
      let value: unknown;
      if (queue) {
        if (queue.length === 0) throw new Error("mockProvider queue exhausted");
        value = queue.shift();
      } else {
        value = (source as (req: MockRequest) => unknown)(withPrompt(req));
      }
      if (isMockToolCalls(value)) {
        return { text: "", toolCalls: value.calls.map((c) => ({ id: c.id ?? `call_${++minted}`, name: c.name, args: c.args })) };
      }
      return { text: JSON.stringify(value) };
    },
  };
}
