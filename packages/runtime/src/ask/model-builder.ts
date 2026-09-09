import {
  type AskKind,
  type InferenceModel,
  type InferenceScope,
  type JsonSchema,
  outputSchema,
  renderClassicText,
  renderScopeBlock,
  renderTaskBlock,
  renderTaskFormat,
  scopeChain,
} from "@nola-lang/core";
import type { InferContext } from "../infer-context/infer-context.js";
import type { Frame } from "../runtime/frame.js";
import { InferType } from "../types/infer-type.js";
import type { InferenceComposer, IntentComposer, IntentInput, ScopeComposer, ScopeDescription } from "./composer.js";
import { type ExtractPromptScope, type FunctionPromptScope, renderTemplate } from "./prompt-render.js";
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
 * to pure JSON (native type text, wire schema, innermost-first scope chain)
 * and runs pass 2: templates render outer→inner from a scope built over the
 * model — `.default` is the classic block, `.next` the classic remainder —
 * into per-node `text` overrides. The default wording is never in the model.
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
      ...(d.file !== undefined ? { file: d.file } : {}),
      instruction: d.instruction,
      args: d.args.map((a) => {
        // JSON.stringify returns undefined for a function/symbol value (never a parse
        // error) — such a value is simply omitted, same as an absent contextual value.
        // BigInt throws on stringify; let it propagate rather than special-casing it.
        // The round trip through JSON.stringify/parse is text-preserving for
        // renderScopeBlock's rendering EXCEPT for a value whose toJSON() (or the value
        // itself) yields a multi-line string — that then renders as a <value> block
        // instead of an inline JSON string, same as a plain multi-line string always has.
        const json = a.value === undefined ? undefined : JSON.stringify(a.value);
        return {
          name: a.name,
          ...(a.type ? { type: a.type.toNativeType() } : {}),
          contextual: a.contextual,
          ...(json !== undefined ? { value: JSON.parse(json) } : {}),
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
    // Pass 2 must run BEFORE the freeze below — it still writes `text`/`coversRemainder`
    // overrides onto `model` and its scopes.
    this.renderTemplates(model, outerToInner, state.input, state.outputType, state.site);
    // Frozen so nothing downstream (a hook reading the `onProviderRequest` event, a
    // provider's `complete`) can mutate what is meant to be the immutable canonical ask.
    // A shallow `{ ...model, correction }` (correctionRequest) still works: the spread
    // produces a fresh, unfrozen object even though its nested scope/args are shared.
    return deepFreeze(model);
  }

  private renderTemplates(
    model: InferenceModel,
    descriptions: ScopeDescription[],
    input: IntentInput,
    outputType: JsonSchema | InferType<unknown> | undefined,
    site: string,
  ): void {
    const chain = scopeChain(model);
    const finalized = new Set<number>();
    const remainder = new Map<number, string>();
    // Renders scopes j.. and the TASK with their templates already applied (memoized).
    const rest = (j: number): string => {
      let text = remainder.get(j);
      if (text === undefined) {
        for (let k = j; k <= chain.length; k++) finalize(k);
        text = renderClassicText(model, j);
        remainder.set(j, text);
      }
      return text;
    };
    const finalize = (i: number): void => {
      if (finalized.has(i)) return;
      finalized.add(i);
      if (i === chain.length) {
        finalizeTask();
        return;
      }
      const d = descriptions[i] as ScopeDescription;
      const s = chain[i] as InferenceScope;
      if (!d.template) return;
      const nested = i > 0;
      let nextRead = false;
      const scope: FunctionPromptScope = Object.freeze({
        fn: s.fn,
        signature: `${s.fn}(${s.args.map((a) => a.name).join(", ")})`,
        ...(s.file !== undefined ? { file: s.file } : {}),
        args: Object.freeze(s.args.map((a) => Object.freeze({ ...a }))),
        nested,
        hasContext: nested,
        // The template IS the instruction: the default block renders without Purpose.
        get default() {
          return renderScopeBlock({ ...s, instruction: "" }, nested);
        },
        get next() {
          nextRead = true;
          return rest(i + 1);
        },
      });
      s.text = renderTemplate(d.template, scope, `${s.file ?? "<unknown>"}:${s.fn}`, () => "", () => true);
      if (nextRead) s.coversRemainder = true;
    };
    const finalizeTask = (): void => {
      if (!input.template) return;
      const hasContext = chain.length > 0;
      const schema = outputSchema(model.output);
      const typeText = InferType.isInferType(outputType) ? outputType.toNativeType() : JSON.stringify(schema);
      let formatRead = false;
      const scope: ExtractPromptScope = Object.freeze({
        type: typeText,
        schema: JSON.stringify(schema),
        hasContext,
        get default() {
          return renderTaskBlock(model, hasContext);
        },
        get format() {
          formatRead = true;
          return renderTaskFormat(schema);
        },
      });
      // The implicit tail of an extractor template is the response discipline.
      model.input.text = renderTemplate(input.template, scope, site, () => renderTaskFormat(schema), () => formatRead);
    };
    for (let i = 0; i <= chain.length; i++) finalize(i);
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

/** Compose one ask's model: the ask-site node first (the intent), then the frame chain (scopes). */
export function buildInferenceModel(init: { frame: Frame; context: InferContext; site: string; system?: string }): InferenceModel {
  const builder = new ModelBuilder({ site: init.site, ...(init.system !== undefined ? { system: init.system } : {}) });
  init.context.compose(builder);
  init.frame.compose(builder);
  return builder.build();
}
