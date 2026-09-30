import type { AskKind, InferenceModel, InferenceScope, JsonSchema } from "@nola-lang/core";
import type { InferContext, VisibleContext } from "../infer-context/infer-context.js";
import type { Frame } from "../runtime/frame.js";
import { asCarrier, type InferType } from "../types/infer-type.js";
import type { InferenceComposer, IntentComposer, IntentInput, ScopeComposer, ScopeDescription } from "./composer.js";
import { wireSchema } from "./wire-schema.js";

interface BuilderState {
  site: string;
  system?: string;
  intent?: AskKind;
  input?: IntentInput;
  outputType?: JsonSchema | InferType<unknown>;
  /** index = frame depth (0 = the asking frame); undefined = a frame whose node described nothing */
  levels: Array<ScopeDescription | undefined>;
}

class IntentSink implements IntentComposer {
  constructor(private readonly state: BuilderState) {}
  input(init: IntentInput): this {
    this.state.input = init;
    return this;
  }
  output(type?: JsonSchema | InferType<unknown>): this {
    this.state.outputType = type;
    return this;
  }
}

class ScopeSink implements ScopeComposer {
  constructor(
    private readonly state: BuilderState,
    private readonly depth: number,
  ) {}
  describe(init: ScopeDescription): this {
    this.state.levels[this.depth] = init;
    return this;
  }
}

class LevelComposer implements InferenceComposer {
  constructor(
    protected readonly state: BuilderState,
    private readonly depth: number,
  ) {}
  intent(kind: AskKind): IntentComposer {
    this.state.intent = kind;
    return new IntentSink(this.state);
  }
  scope(): ScopeComposer {
    return new ScopeSink(this.state, this.depth);
  }
  outer(): InferenceComposer {
    return new LevelComposer(this.state, this.depth + 1);
  }
}

/**
 * The one builder. Pass 1 (compose calls) collects data; build() resolves it
 * to pure JSON — native type text, wire schema, innermost-first scope chain —
 * and freezes it. No wording is ever in the model: rendering is the
 * provider's (`renderPrompt` in core is the default).
 */
export class ModelBuilder extends LevelComposer {
  constructor(init: { site: string; system?: string }) {
    super({ site: init.site, ...(init.system !== undefined ? { system: init.system } : {}), levels: [] }, 0);
  }

  build(): InferenceModel {
    const { state } = this;
    if (!state.intent || !state.input) throw new Error("ModelBuilder.build(): no intent was composed for this ask.");
    const described = state.levels.filter((l): l is ScopeDescription => l !== undefined);
    const outerToInner = [...described].reverse();
    const scopes: InferenceScope[] = outerToInner.map((d) => ({
      fn: d.fn,
      ...(d.module ? { module: true as const } : {}),
      ...(d.lexical ? { lexical: true as const } : {}),
      ...(d.file !== undefined ? { file: d.file } : {}),
      instruction: d.instruction,
      args: d.args.map((a) => {
        // JSON.stringify returns undefined for a function/symbol value (never a parse
        // error) — such a value is simply omitted, same as an absent contextual value.
        // BigInt throws on stringify; let it propagate rather than special-casing it.
        // The round trip through JSON.stringify/parse is text-preserving for
        // renderContextBlock's rendering EXCEPT for a value whose toJSON() (or the value
        // itself) yields a multi-line string — that then renders as a <value> block
        // instead of an inline JSON string, same as a plain multi-line string always has.
        const json = a.value === undefined ? undefined : JSON.stringify(a.value);
        return {
          name: a.name,
          ...(a.type ? { type: asCarrier(a.type).toNativeType() } : {}),
          contextual: a.contextual,
          ...(json !== undefined ? { value: JSON.parse(json) } : {}),
          ...(a.local ? { local: true as const } : {}),
        };
      }),
    }));
    for (let i = 1; i < scopes.length; i++) (scopes[i] as InferenceScope).parent = scopes[i - 1];
    const innermost = scopes[scopes.length - 1];
    const model: InferenceModel = {
      intent: state.intent,
      input: {
        instruction: state.input.instruction,
        ...(state.input.callee !== undefined ? { callee: state.input.callee } : {}),
        ...(state.input.hint !== undefined ? { hint: state.input.hint } : {}),
      },
      ...(innermost ? { scope: innermost } : {}),
      ...(state.system !== undefined && state.system !== "" ? { system: state.system } : {}),
      output: { syntax: "json", schema: wireSchema(state.outputType) },
    };
    // Frozen so nothing downstream (a hook reading the `onProviderRequest` event, a
    // provider's `infer`) can mutate what is meant to be the immutable canonical ask.
    // A shallow `{ ...model, correction }` (correctionRequest) still works: the spread
    // produces a fresh, unfrozen object even though its nested scope/args are shared.
    return deepFreeze(model);
  }
}

/**
 * Recursively `Object.freeze`s a plain JSON-shaped value (objects and
 * arrays only — the model's contents by construction). Does not chase
 * anything beyond plain recursion: arg `value` payloads are already JSON
 * (round-tripped through JSON.stringify/parse above), so freezing them
 * plainly is exactly what "frozen JSON" means.
 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

/**
 * Compose one ask's model: the ask-site node first (the intent), then the
 * frame chain (scopes). `visible` is what the ask site sees — its bindings and
 * context items describe the asking frame's scope.
 */
export function buildInferenceModel(init: {
  frame: Frame;
  context: InferContext;
  site: string;
  system?: string;
  visible?: VisibleContext;
}): InferenceModel {
  const builder = new ModelBuilder({ site: init.site, ...(init.system !== undefined ? { system: init.system } : {}) });
  init.context.compose(builder);
  init.frame.compose(builder, init.visible);
  return builder.build();
}
