import type { AskContext, AskResult, NolaMiddleware } from "@nola-lang/core";

/**
 * Onion execution: middleware[0] is outermost. A stage that returns without
 * calling next() short-circuits the rest of the chain and the terminal stage.
 * A stage that throws fails the ask (middleware is part of semantics).
 */
export async function runPipeline(
  middleware: readonly NolaMiddleware[],
  ctx: AskContext,
  terminal: (ctx: AskContext) => Promise<AskResult>,
): Promise<AskResult> {
  const dispatch = (index: number): ((ctx: AskContext) => Promise<AskResult>) => {
    let called = false;
    return (current: AskContext) => {
      if (called) {
        const name = middleware[index - 1]?.name || `middleware[${index - 1}]`;
        throw new Error(`nola middleware ${name} called next() more than once`);
      }
      called = true;
      const stage = middleware[index];
      if (!stage) return terminal(current);
      return stage(current, dispatch(index + 1));
    };
  };
  return dispatch(0)(ctx);
}
