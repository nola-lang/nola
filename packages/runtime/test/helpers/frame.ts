import { Frame, type FunctionScopeInit, type IntentOptions, nolaRuntime } from "@nola-lang/runtime";

/**
 * Root frame over a fn node — the shape ask-path tests thread as `frame`.
 * Data with a string `fn` mints a real FunctionInferContext (composes a
 * CONTEXT block); anything else stays a bare scope node (composes nothing).
 */
export function openTestFrame(init?: {
  file?: string;
  data?: Record<string, unknown>;
  options?: IntentOptions;
}): Frame {
  const file = nolaRuntime.current().fileContext(init?.file ?? "x.tsi");
  const data = init?.data ?? { fn: "go", instruction: "" };
  const infer =
    typeof data.fn === "string" ? file.func(data as unknown as FunctionScopeInit) : file.scope(data);
  return Frame.open(infer, init?.options);
}
