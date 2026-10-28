/**
 * The tool capability (tool-use spec 2026-10-08 §3.6): a model carrying this
 * brand can RETURN TOOL CALLS — `InferResult.toolCalls` — for an intent that
 * offers tools, which is what the tool-use loop runs on. A model without it
 * would answer the task text and ignore the tools, so the runtime refuses a
 * tool-use ask before the network unless the resolved model is branded
 * (NOLA3019). Set by the vendor models, by `mockProvider(…, { tools: true })`
 * and by `replay()`; combinators carry it forward, and `fallback` /
 * `roundRobin` skip unbranded inners on a tool-use request — the decision
 * brand's rules, one for one.
 */
export const TOOL_MODEL: unique symbol = Symbol.for("nola.toolModel");

export function isToolModel(value: unknown): boolean {
  return !!value && typeof value === "object" && (value as { [TOOL_MODEL]?: unknown })[TOOL_MODEL] === true;
}

/** A request whose intent offers tools — the loop may follow. */
export function isToolUseRequest(req: { intent: { tools?: readonly unknown[] } }): boolean {
  return (req.intent.tools?.length ?? 0) > 0;
}
