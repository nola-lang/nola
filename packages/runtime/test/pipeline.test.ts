import { type AskContext, type AskResult, type NolaMiddleware, Site } from "@nola-lang/core";
import { runPipeline } from "@nola-lang/runtime";
import { describe, expect, it, vi } from "vitest";

function makeCtx(): AskContext {
  const ctx = {
    prompt: "p",
    provider: undefined as AskContext["provider"],
    meta: {} as Record<string, unknown>,
  } as AskContext;
  for (const [key, value] of Object.entries({
    askId: "a1",
    site: new Site("x.tsi", "1:1"),
    schema: { type: "string" } as const,
    originalPrompt: "p",
  })) {
    Object.defineProperty(ctx, key, { value, writable: false, enumerable: true });
  }
  return ctx;
}

const terminal = async (ctx: AskContext): Promise<AskResult> => ({ value: ctx.prompt, servedBy: "terminal" });

describe("runPipeline", () => {
  it("runs the terminal stage when there is no middleware", async () => {
    await expect(runPipeline([], makeCtx(), terminal)).resolves.toEqual({ value: "p", servedBy: "terminal" });
  });

  it("applies stages as an onion — first entry is outermost", async () => {
    const order: string[] = [];
    const a: NolaMiddleware = async (ctx, next) => {
      order.push("a:in");
      const r = await next(ctx);
      order.push("a:out");
      return r;
    };
    const b: NolaMiddleware = async (ctx, next) => {
      order.push("b:in");
      const r = await next(ctx);
      order.push("b:out");
      return r;
    };
    await runPipeline([a, b], makeCtx(), terminal);
    expect(order).toEqual(["a:in", "b:in", "b:out", "a:out"]);
  });

  it("lets a stage mutate the prompt before the terminal sees it", async () => {
    const prefix: NolaMiddleware = async (ctx, next) => {
      ctx.prompt = `Be terse. ${ctx.prompt}`;
      return next(ctx);
    };
    const result = await runPipeline([prefix], makeCtx(), terminal);
    expect(result.value).toBe("Be terse. p");
  });

  it("short-circuits when a stage returns without calling next", async () => {
    const term = vi.fn(terminal);
    const cache: NolaMiddleware = async () => ({ value: "cached", servedBy: "cache" });
    const result = await runPipeline([cache], makeCtx(), term);
    expect(result).toEqual({ value: "cached", servedBy: "cache" });
    expect(term).not.toHaveBeenCalled();
  });

  it("propagates a throwing stage (middleware failures fail the ask)", async () => {
    const boom: NolaMiddleware = async () => {
      throw new Error("middleware exploded");
    };
    await expect(runPipeline([boom], makeCtx(), terminal)).rejects.toThrow("middleware exploded");
  });

  it("throws when a stage calls next() twice", async () => {
    const twice: NolaMiddleware = async (ctx, next) => {
      await next(ctx);
      return next(ctx);
    };
    await expect(runPipeline([twice], makeCtx(), terminal)).rejects.toThrow(/called next\(\) more than once/);
  });

  it("refuses to mutate runtime-owned fields (frozen at runtime)", () => {
    const ctx = makeCtx();
    expect(() => {
      (ctx as { schema: unknown }).schema = { type: "number" };
    }).toThrow(TypeError);
  });
});
