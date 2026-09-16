import { type ConsoleTask, createDebugTask, NolaResolutionError, Site } from "@nola-lang/core";
import { JsonInference } from "../../ask/inference-json.js";
import type { InferContext } from "../../infer-context/infer-context.js";
import { type Frame, type NolaRuntime, nolaRuntime } from "../../runtime/index.js";
import { inferTypes, type TypeCarrier } from "../../types/infer-type.js";
import { ExecutableIntent } from "../executable-intent.js";
import { ExtractIntent } from "../extract/extract-intent.js";
import { Intent, type IntentOptions } from "../intent.js";
import { FunctionCallContext, type FunctionCallIntentParams } from "./function-call-context.js";


interface Slot {
  path: string;
  intent: ExtractIntent<unknown>;
}

export class FunctionCallIntent<T = unknown> extends ExecutableIntent<T, FunctionCallContext> {
  /**
   * Debugger bridge for F11 at `ask fn(..`x`<T>)`: the target function is
   * invoked in a microtask after the slot-filling provider round-trip, which
   * V8's async stepping cannot track — a step-into surfaced in the runtime's
   * ask machinery instead of the target's body. Scheduled at construction
   * (inside the ask site's step window) and run around the TARGET INVOCATION
   * only, so the pause lands right before user code (mirror of
   * InvocationIntent's "nola infer" task).
   */
  private readonly debugTask: ConsoleTask | undefined;

  constructor(
    private readonly init: FunctionCallIntentParams,
    runtime: NolaRuntime = nolaRuntime.current(),
    options: IntentOptions = {},
  ) {
    super(new FunctionCallContext(init, runtime), options);
    this.debugTask = createDebugTask("nola call");
  }

  /** Preserve the concrete type so options (e.g. a provider pin) reach execute(). */
  protected override clone(patch: Partial<IntentOptions>): Intent<T> {
    return new FunctionCallIntent<T>(this.init, this.runtime, { ...this.options, ...patch });
  }

  private fail(message: string, infer: InferContext, raw = ""): NolaResolutionError {
    return new NolaResolutionError(message, {
      prompt: this.init.instruction ?? "",
      raw,
      site: new Site(infer.sourceFile(), this.init.loc ?? "?"),
    });
  }

  private collectSlots(value: unknown, path: string, slots: Slot[], infer: InferContext): void {
    if (value instanceof ExtractIntent) {
      slots.push({ path, intent: value });
      return;
    }
    if (Intent.isIntent(value)) {
      throw this.fail(`only extractor intents may be call-intent arguments in this Nola version (at ${path})`, infer);
    }
    if (Array.isArray(value)) {
      value.forEach((el, i) => {
        this.collectSlots(el, `${path}_${i}`, slots, infer);
      });
    } else if (this.isPlainObject(value)) {
      for (const [k, v] of Object.entries(value)) this.collectSlots(v, `${path}_${k}`, slots, infer);
    }
  }

  private substitute(value: unknown, path: string, values: Record<string, unknown>): unknown {
    // already revived: the slot-filling ask validated the combined carrier in one pass
    if (value instanceof ExtractIntent) return values[path];
    if (Array.isArray(value)) return value.map((el, i) => this.substitute(el, `${path}_${i}`, values));
    if (this.isPlainObject(value)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = this.substitute(v, `${path}_${k}`, values);
      return out;
    }
    return value;
  }

  protected async execute(frame: Frame): Promise<T> {
    const fn = this.init.fn;
    if (typeof fn !== "function") {
      throw this.fail(`call intent target "${this.init.name}" is not a function`, frame.infer);
    }
    const slots: Slot[] = [];
    this.init.args.forEach((arg, i) => {
      this.collectSlots(arg, `arg${i}`, slots, frame.infer);
    });
    let finalArgs = this.init.args;
    if (slots.length > 0) {
      // One object carrier, one property per slot, each described by its
      // instruction. Cyclic slot types serialize as $defs through the carrier
      // exactly as a plain extract does, so nothing is hoisted by hand.
      const props: Record<string, TypeCarrier<unknown>> = {};
      for (const s of slots) {
        const slotType = s.intent.slotType() ?? inferTypes.string();
        props[s.path] = slotType.describe(s.intent.spec.instruction);
      }
      // ONE combined ask for every slot — composed by this call's own node
      // (intent: "call"); the classic rendering is the same TASK grammar as a plain extract.
      const values = (await new JsonInference({
        frame,
        site: new Site(frame.sourceFile(), this.init.loc ?? "?"),
        options: this.options,
        context: this.inferContext.forSlots(inferTypes.object(props)),
      }).infer()) as Record<string, unknown>;
      finalArgs = this.init.args.map((arg, i) => this.substitute(arg, `arg${i}`, values));
    }
    const invoke = () => (fn as (...a: unknown[]) => unknown)(...finalArgs);
    let result: unknown = this.debugTask ? this.debugTask.run(invoke) : invoke();
    if (result !== null && typeof (result as PromiseLike<unknown>)?.then === "function") {
      result = await result;
    }
    frame.history.push({ prompt: `called ${this.init.name}`, value: result });
    return result as T;
  }

  private isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  }
}
