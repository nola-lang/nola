import { type ModelRef, type ProviderParams, Site } from "@nola-lang/core";
import { ToolUseInference } from "../../ask/tool-use-inference.js";
import { type Frame, type NolaRuntime, nolaRuntime } from "../../runtime/index.js";
import { ExecutableIntent } from "../executable-intent.js";
import type { Intent, IntentOptions } from "../intent.js";
import { ToolUseContext, type ToolUseIntentParams } from "./tool-use-context.js";

/**
 * An ask with a tool list (spec 2026-10-08): `` ask `task` [fn, g.h]: T ``.
 * Resolves through the bounded loop of ToolUseInference on the ask-site frame
 * — no frame of its own, like an extractor — and lands one history record.
 * The fluent methods keep the concrete type so `.withMaxTurns` chains after
 * any of them; together they are the public `ToolUseAskable<T>` tier.
 */
export class ToolUseIntent<T = unknown> extends ExecutableIntent<T, ToolUseContext> {
  constructor(props: ToolUseIntentParams, runtime: NolaRuntime = nolaRuntime.current(), options: IntentOptions = {}) {
    super(new ToolUseContext(props, runtime), options);
  }

  protected override clone(patch: Partial<IntentOptions>): ToolUseIntent<T> {
    return new ToolUseIntent<T>(this.inferContext.data, this.runtime, { ...this.options, ...patch });
  }

  /** The provider turns the loop may take before it must have answered; the correction turn is not counted. */
  withMaxTurns(turns: number): ToolUseIntent<T> {
    if (!Number.isInteger(turns) || turns < 1) {
      throw new RangeError(`.withMaxTurns(${String(turns)}): the turn cap is a positive integer.`);
    }
    return this.clone({ maxTurns: turns });
  }

  override withRetry(retries: number): ToolUseIntent<T> {
    return super.withRetry(retries) as ToolUseIntent<T>;
  }

  override withModel(model: ModelRef): ToolUseIntent<T> {
    return super.withModel(model) as ToolUseIntent<T>;
  }

  override withParams(params: ProviderParams): ToolUseIntent<T> {
    return super.withParams(params) as ToolUseIntent<T>;
  }

  override withTimeout(timeout: number): ToolUseIntent<T> {
    return super.withTimeout(timeout) as ToolUseIntent<T>;
  }

  override detached(): Intent<T> {
    return super.detached();
  }

  protected async execute(frame: Frame): Promise<T> {
    const { inferContext: context, options } = this;
    const value = await new ToolUseInference(
      {
        frame,
        site: new Site(frame.sourceFile(), context.data.loc ?? "?"),
        options,
        context,
      },
      () => context.entries(),
    ).infer();
    frame.history.push({ prompt: context.instructionText, value });
    return value as T;
  }
}
