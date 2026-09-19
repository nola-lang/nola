import { Codes } from "@nola-lang/ast";
import type { ModelConfigEntry, ModelRef, NolaConfig, NolaTelemetry } from "@nola-lang/core";
import { isPlatformModel, NolaConfigError, redactError } from "@nola-lang/core";
import { type ResolvedNolaConfig, resolveNolaConfig } from "../config.js";
import { FileInferContext, SystemInferContext } from "../infer-context/index.js";
import type { IntentOptions } from "../intents/intent.js";
import type { InvocationContext } from "../intents/invocation/invocation-context.js";
import type { ModuleContext } from "../intents/invocation/module-context.js";
// call-time-only cycle with terminal-trace.ts (via ingest-envelope.ts): both directions resolve inside function bodies.
import { terminalTrace } from "../terminal-trace.js";
import { Frame } from "./frame.js";

let defaultList: readonly NolaTelemetry[] | undefined;
/** The unconfigured observer list — what `telemetry` defaults to: `terminalTrace()` at `debug`. Built lazily (module cycle). */
function defaultTelemetry(): readonly NolaTelemetry[] {
  defaultList ??= Object.freeze([terminalTrace()]);
  return defaultList;
}

export type HookMethod =
  | "onAskStart"
  | "onProviderRequest"
  | "onProviderResponse"
  | "onValidationFailed"
  | "onRetry"
  | "onAskEnd"
  | "onInvocationStart"
  | "onInvocationEnd";

/**
 * The central runtime entity — the value stored in the process-wide slot.
 * One instance per process (per emit contract); every runtime copy adopts the
 * first claimant's instance, so provider config is never split-brained.
 */
export class NolaRuntime {
  
  #config: ResolvedNolaConfig | null = null;
  #latched = false;

  constructor(
    readonly emit: number,
    readonly url: string,
  ) {}

  /** The frozen resolved config, or null when nothing has been configured yet. */
  get config(): ResolvedNolaConfig | null {
    return this.#config;
  }

  /** Validate a raw config and store the frozen result. Frozen for good once the first ask latches it. */
  configure(config: NolaConfig | ResolvedNolaConfig, opts?: { source?: string }): void {
    if (this.#latched) {
      throw new NolaConfigError(
        "Nola configuration is frozen after the first ask — call nolaRuntime.reset() before reconfiguring.",
        Codes.ConfigInvalid,
      );
    }
    this.#config = resolveNolaConfig(config, opts);
  }

  /** Ask-time config read: the first non-null read freezes configuration ("read once"). */
  latchConfig(): ResolvedNolaConfig | null {
    if (this.#config) this.#latched = true;
    return this.#config;
  }

  /** Precedence: forceModel → explicit ref (instance as-is, name via map) → default. */
  resolveModel(ref?: ModelRef): ModelConfigEntry {
    return this.resolveModelProfile(ref).model;
  }

  /**
   * The routing ladder, plus managed-mode inference profiles: under a managed
   * default (what `model: "nola"` / `nola.infer()` supplies) an ask-site name that names no
   * configured provider is NOT an error — the ask resolves to the serving
   * model (default, or forceModel) and the name rides the request as
   * `profile` for the hosted service's smart routing. The profile is computed
   * from (name, provider map) alone, force or not, so record/replay
   * fingerprints agree between live and forced runs. Any other config keeps
   * strict name validation (NOLA3004).
   */
  resolveModelProfile(ref?: ModelRef): { model: ModelConfigEntry; profile?: string } {
    const config = this.#config;
    if (!config) {
      throw new NolaConfigError(
        "No Nola model configured. Run through `nola run` / `node --import nola-lang/register` with a nola.config.ts, or call nolaRuntime.configure({ model: <model> }) before invoking nola functions.",
      );
    }
    const managed = config.model.default !== undefined && isPlatformModel(config.model.default);
    const profile =
      typeof ref === "string" && !(ref in config.model) && managed ? ref : undefined;
    if (config.forceModel !== undefined) {
      return { model: this.#namedModel(config, config.forceModel, "forceModel"), profile };
    }
    if (ref === undefined) return { model: this.#namedModel(config, "default", "model"), profile: undefined };
    if (typeof ref !== "string") return { model: ref, profile: undefined };
    if (profile !== undefined) return { model: this.#namedModel(config, "default", "model"), profile };
    return { model: this.#namedModel(config, ref, ".withModel()"), profile: undefined };
  }

  #namedModel(config: ResolvedNolaConfig, name: string, what: string): ModelConfigEntry {
    const provider = config.model[name];
    if (!provider) {
      throw new NolaConfigError(
        `${what} "${name}" does not name a configured model — configured: ${Object.keys(config.model).join(", ")}. ` +
          '(With the platform serving inference — model: "nola" — an unconfigured name is legal: it is sent as an inference profile.)',
        Codes.ConfigUnknownModel,
      );
    }
    return provider;
  }

  openFrame(inferContext: InvocationContext | ModuleContext, options: IntentOptions): Frame {
    // TODO: add tracking of opened frames 
    return Frame.open(inferContext, options);
  }

  #system?: SystemInferContext;

  /** Process-scope root context. Lazy; its message thunk reads whatever config is latched at ask time. */
  get system(): SystemInferContext {
    this.#system = this.#system ?? SystemInferContext.create(() => this.#config?.system?.message, this);

    return this.#system;
  }

  readonly #fileContexts = new Map<string, FileInferContext>();

  /** Memoized root context for a .tsi file, parented under `system` (no emitted module state — TDZ-safe). */
  fileContext(file: string): FileInferContext {
    let ctx = this.#fileContexts.get(file);
    if (!ctx) {
      ctx = FileInferContext.create(file, this.system, this);
      this.#fileContexts.set(file, ctx);
    }
    return ctx;
  }

  readonly #hookWarnings = new Set<string>();

  /** Observers that receive events: the resolved telemetry list in order; unconfigured, the terminal sink alone. */
  #activeHooks(): readonly NolaTelemetry[] {
    return this.#config?.telemetry ?? defaultTelemetry();
  }

  /**
   * Dispatch one event to every hook. Observers must never break resolution:
   * a throwing hook is swallowed and warned about once per (hook, method).
   */
  emitEvent<M extends HookMethod>(method: M, event: Parameters<NonNullable<NolaTelemetry[M]>>[0]): void {
    for (const hook of this.#activeHooks()) {
      const handler = hook[method];
      if (typeof handler !== "function") continue;
      try {
        (handler as (e: unknown) => void).call(hook, event);
      } catch (error) {
        const key = `${hook.name ?? "<anonymous>"}::${method}`;
        if (this.#hookWarnings.has(key)) continue;
        this.#hookWarnings.add(key);
        console.warn(`[nola] hook ${key} threw and was ignored: ${redactError(error)}`);
      }
    }
  }
}
