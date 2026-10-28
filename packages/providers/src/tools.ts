import { Codes } from "@nola-lang/ast";
import type { InferenceModel, JsonSchema, Message, ToolCall, ToolDescription, ToolUseMode, ToolUseTurn } from "@nola-lang/core";
import { NolaConfigError, renderPrompt, TOOL_MODEL, toolWireName } from "@nola-lang/core";

/**
 * Tool use on the vendor wires (spec 2026-10-08 §3.6). Every tool goes out
 * under its WIRE name (`toolWireName`: the written `fs.readFile` as
 * `fs_readFile`), and a model's call comes back under that name — the
 * runtime maps it to the entry. Where a vendor cannot mix its structured
 * output with tools, the answer is one more tool, ANSWER_TOOL, carrying the
 * output schema: a call to it ends the loop with the answer, a call to any
 * other tool continues it. The technique is invisible outside the provider.
 */
export const ANSWER_TOOL = "nola_answer";
export const ANSWER_TOOL_DESCRIPTION = "Return the final answer to the task. Call it once you have what you need; call the other tools first when you do not.";

/** The strategies a vendor model can be configured for; grows as strategies land. */
export const TOOL_USE_MODES: readonly ToolUseMode[] = ["native"];

/**
 * The vendor factories' `toolUse` option, validated at construction: the
 * TOOL_MODEL brand unless the host offers no tool use (`false`), and the
 * strategy recorded on the model for the runtime and the combinators to read.
 */
export function toolUseBrand(
  factory: string,
  toolUse: ToolUseMode | false | undefined,
): { readonly [TOOL_MODEL]?: true; readonly toolUse?: ToolUseMode | false } {
  if (toolUse !== undefined && toolUse !== false && !TOOL_USE_MODES.includes(toolUse)) {
    throw new NolaConfigError(
      `${factory}(): toolUse must be ${TOOL_USE_MODES.map((m) => JSON.stringify(m)).join(", ")} or false, got ${JSON.stringify(toolUse)}.`,
      Codes.ConfigInvalid,
    );
  }
  return {
    ...(toolUse === false ? {} : { [TOOL_MODEL]: true as const }),
    ...(toolUse !== undefined ? { toolUse } : {}),
  };
}

export interface WireTool {
  name: string;
  description?: string;
  parameters: JsonSchema;
}

/** The intent's tools under their wire names; empty when the ask offers none. */
export function wireTools(intent: Pick<InferenceModel, "tools">): WireTool[] {
  return (intent.tools ?? []).map((t: ToolDescription) => ({
    name: toolWireName(t.name),
    ...(t.description !== undefined ? { description: t.description } : {}),
    parameters: t.parameters,
  }));
}

/**
 * The conversation with the transcript left OUT — the task turn and, when one
 * ran, the correction pair — so a provider can splice the transcript in its
 * native form between them. The system turn is the intent's, as renderPrompt
 * decides it.
 */
export function splitMessages(intent: InferenceModel): { system: string; task: Message; tail: Message[] } {
  const { transcript: _transcript, ...withoutTranscript } = intent;
  const { system, messages } = renderPrompt(withoutTranscript);
  const [task, ...tail] = messages;
  return { system, task: task as Message, tail };
}

/** The transcript turns, for a provider rendering them natively. */
export function transcriptTurns(intent: Pick<InferenceModel, "transcript">): readonly ToolUseTurn[] {
  return intent.transcript ?? [];
}

/** JSON arguments as the vendor sent them; a string that is not JSON passes through for the runtime's validation to report. */
export function parseArgs(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** The answer a call to ANSWER_TOOL carries, unwrapped from the `{ value }` envelope when the schema was enveloped; an enveloped input without `value` goes through as written, so validation reports the shape. */
export function answerFromTool(input: unknown, enveloped: boolean): string {
  const value = enveloped ? (input as { value?: unknown } | null)?.value : input;
  return JSON.stringify(value === undefined ? input : value);
}

/** Split a vendor reply's calls into the answer (a call to ANSWER_TOOL) and the real tool calls. */
export function partitionCalls(calls: readonly ToolCall[]): { answer?: ToolCall; tools: ToolCall[] } {
  const answer = calls.find((c) => c.name === ANSWER_TOOL);
  return { ...(answer ? { answer } : {}), tools: calls.filter((c) => c.name !== ANSWER_TOOL) };
}
