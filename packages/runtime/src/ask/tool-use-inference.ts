import { Codes } from "@nola-lang/ast";
import {
  fingerprintRequest,
  formatIssues,
  type InferenceModel,
  type InferRequest,
  type InferResult,
  type JsonSchema,
  type LanguageModel,
  NolaIntentError,
  redactError,
  type ToolCall,
  type ToolCallReceipt,
  type ToolCallRecord,
  type ToolUseTurn,
  toolWireName,
} from "@nola-lang/core";
import { DEFAULT_MAX_TURNS } from "../config.js";
import type { ToolEntry } from "../intents/tool-use/tool-use-context.js";
import { TypeCarrier } from "../types/infer-type.js";
import { validateCarrier } from "../types/validate-carrier.js";
import { fmt } from "./fmt.js";
import type { InferenceTask } from "./inference.js";
import { JsonInference } from "./inference-json.js";
import { type ValidationResult, validate } from "./validate.js";

/** What running one requested call produced: a record for the model and a receipt line, or the failure that ends the ask. */
type ToolOutcome = { record: ToolCallRecord; receipt: ToolCallReceipt } | { receipt: ToolCallReceipt; error: unknown };

/**
 * The tool-use loop (spec 2026-10-08 §3.5): one ask span, N provider calls.
 * The base composes, fingerprints and makes the first call; this strategy
 * takes over while the reply carries tool calls — run them in the reply's
 * order, append the turn to the transcript, call again with it — and hands
 * the answer back to the base's validation and single correction turn. Each
 * turn is fingerprinted and lands on the receipt; a thrown tool or the turn
 * cap ends the ask definitively, transcript attached.
 */
export class ToolUseInference extends JsonInference {
  constructor(
    task: InferenceTask,
    /** the materialized entries (spec 2026-10-09 §3.5) — a thunk, since the list is built when the ask composes */
    private readonly tools: () => readonly ToolEntry[],
  ) {
    super(task);
  }

  private get maxTurns(): number {
    return this.task.options.maxTurns ?? this.runtime.config?.ask.maxTurns ?? DEFAULT_MAX_TURNS;
  }

  protected override async converse(
    provider: LanguageModel,
    model: InferenceModel,
    first: InferResult,
    requestFor: (m: InferenceModel) => InferRequest,
  ): Promise<{ res: InferResult; model: InferenceModel }> {
    let res = first;
    let current = model;
    let fingerprint = this.span.fingerprint;
    const transcript: ToolUseTurn[] = [];
    let turn = 1;
    while (res.toolCalls && res.toolCalls.length > 0) {
      const calls: ToolCallRecord[] = [];
      const receipts: ToolCallReceipt[] = [];
      const text = res.text !== "" ? { text: res.text } : {};
      const turnReceipt = { ...(fingerprint !== undefined ? { fingerprint } : {}), ...text, calls: receipts };
      this.span.turns.push(turnReceipt);
      for (const call of res.toolCalls) {
        const outcome = await this.runTool(call, turn);
        receipts.push(outcome.receipt);
        if ("error" in outcome) throw this.toolFailure(outcome, transcript);
        calls.push(outcome.record);
      }
      transcript.push({ ...text, calls });
      turn++;
      if (turn > this.maxTurns) {
        throw withTranscript(
          new NolaIntentError(
            `tool use at ${this.site} exceeded ${this.maxTurns} turn${this.maxTurns === 1 ? "" : "s"} without an answer (\`.withMaxTurns(n)\` or config ask.maxTurns raise the cap).`,
            Codes.ToolUseTurnsExceeded,
          ),
          transcript,
        );
      }
      // a shallow spread of the frozen model, as the correction turn makes one
      current = { ...current, transcript: transcript.map((t) => ({ ...t, calls: [...t.calls] })) };
      const request = requestFor(current);
      fingerprint = fingerprintRequest(request);
      res = await this.callProvider(provider, request);
    }
    return { res, model: current };
  }

  private toolFailure(outcome: { receipt: ToolCallReceipt; error: unknown }, transcript: ToolUseTurn[]): NolaIntentError {
    const err = new NolaIntentError(
      `tool "${outcome.receipt.name}" threw during tool use at ${this.site}: ${outcome.receipt.error ?? redactError(outcome.error)}`,
      Codes.ToolCallFailed,
    );
    (err as Error & { cause?: unknown }).cause = outcome.error;
    return withTranscript(err, transcript);
  }

  /**
   * One requested call. An unknown name or invalid arguments never reach a
   * function: the problem goes back to the model as that call's result, and
   * the turn cap bounds how often it may try again. A result is rendered under
   * the `fmt` rule — a string verbatim, anything else JSON — so the model sees
   * what the receipt shows.
   */
  private async runTool(call: ToolCall, turn: number): Promise<ToolOutcome> {
    const tools = this.tools();
    const tool = tools.find((t) => t.name === call.name || toolWireName(t.name) === call.name);
    const feedback = (name: string, result: string): ToolOutcome => ({
      record: { id: call.id, name: call.name, args: call.args, result },
      receipt: { name, args: call.args, result, durationMs: 0 },
    });
    if (!tool) {
      return feedback(call.name, `unknown tool "${call.name}" — the tools are: ${tools.map((t) => t.name).join(", ")}`);
    }
    const checked = checkArgs(tool, call.args);
    if (!checked.ok) return feedback(tool.name, `invalid arguments for "${tool.name}": ${formatIssues(checked.issues)}`);
    const base = {
      askId: this.askId,
      invocationId: this.frame.invocationId,
      spanPath: this.frame.spanPath(),
      turn,
      name: tool.name,
      args: call.args,
    };
    this.runtime.emitEvent("onToolCallStart", base);
    const startedAt = Date.now();
    try {
      let value: unknown = (tool.call as (...a: unknown[]) => unknown)(...positionalArgs(tool, checked.value));
      if (value !== null && typeof (value as PromiseLike<unknown>)?.then === "function") value = await value;
      const result = fmt(value);
      const durationMs = Date.now() - startedAt;
      this.runtime.emitEvent("onToolCallEnd", { ...base, result, durationMs });
      return { record: { id: call.id, name: call.name, args: call.args, result }, receipt: { name: tool.name, args: call.args, result, durationMs } };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = redactError(error);
      this.runtime.emitEvent("onToolCallEnd", { ...base, error: message, durationMs });
      return { receipt: { name: tool.name, args: call.args, error: message, durationMs }, error };
    }
  }
}

/** Carrier-driven when the contract is a carrier (the lowered case — revives dates too), the raw-JsonSchema oracle otherwise. */
function checkArgs(tool: ToolEntry, args: unknown): ValidationResult {
  if (TypeCarrier.is(tool.args)) return validateCarrier(tool.args, args);
  return validate(tool.args as JsonSchema, args);
}

/** The parameter names in declaration order — the carrier's object keys (derive emits them so), or the schema's properties. */
function parameterNames(tool: ToolEntry): readonly string[] | undefined {
  if (TypeCarrier.is(tool.args)) {
    let node = tool.args._node;
    while (node.kind === "constrained") node = node.inner._node;
    return node.kind === "object" ? Object.keys(node.props) : undefined;
  }
  const properties = (tool.args as { properties?: Record<string, unknown> }).properties;
  return properties ? Object.keys(properties) : undefined;
}

/** The arguments in parameter order, read off the validated object by name. */
function positionalArgs(tool: ToolEntry, value: unknown): unknown[] {
  const names = parameterNames(tool);
  if (!names) return [value];
  const record = (value ?? {}) as Record<string, unknown>;
  return names.map((key) => record[key]);
}

function withTranscript<E extends Error>(error: E, transcript: ToolUseTurn[]): E {
  return Object.assign(error, { transcript: transcript.map((t) => ({ ...t, calls: [...t.calls] })) });
}
