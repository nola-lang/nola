import { Codes } from "@nola-lang/ast";
import type { NolaConfig, NolaHook, NolaProvider, ProviderRef } from "@nola-lang/core";
import { NolaConfigError, redactError } from "@nola-lang/core";
import { defaultPromptRenderer, type PromptRenderer } from "../ask/prompt-render.js";
import { type ResolvedNolaConfig, resolveNolaConfig } from "../config.js";
import { FileInferContext, type FunctionInferContext, SystemInferContext } from "../infer-context/index.js";
import type { IntentOptions } from "../intents/intent.js";
// call-time-only cycle with logger.ts: both directions resolve inside function bodies.
import { builtinLogger } from "../logger.js";
import { Frame } from "./frame.js";

export type HookMethod =
  | "onAskStart"
  | "onProviderRequest"
  | "onProviderResponse"
  | "onValidationFailed"
  | "onRetry"
  | "onAskEnd"
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

  /**
   * The provider-facing text seam consulted by every composeInferenceData —
   * the built-in renderer today (config-level overrides are the next step).
   */
  get promptRenderer(): PromptRenderer {
    return defaultPromptRenderer;
  }

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

  /** Precedence: forceProvider → explicit ref (instance as-is, name via map) → default. */
  resolveProvider(ref?: ProviderRef): NolaProvider {
    const config = this.#config;
    if (!config) {
      throw new NolaConfigError(
        "No Nola provider configured. Run through `nola run` / `node --import nola-lang/register` with a nola.config.ts, or call nolaRuntime.configure({ providers: { default: <provider> } }) before invoking nola functions.",
      );
    }
    if (config.forceProvider !== undefined) return this.#namedProvider(config, config.forceProvider, "forceProvider");
    if (ref === undefined) return this.#namedProvider(config, "default", "providers");
    if (typeof ref !== "string") return ref;
    return this.#namedProvider(config, ref, ".withProvider()");
  }

  #namedProvider(config: ResolvedNolaConfig, name: string, what: string): NolaProvider {
    const provider = config.providers[name];
    if (!provider) {
      throw new NolaConfigError(
        `${what} "${name}" does not name a configured provider — configured: ${Object.keys(config.providers).join(", ")}.`,
        Codes.ConfigUnknownProvider,
      );
    }
    return provider;
  }

  openFrame(inferContext: FunctionInferContext, options: IntentOptions): Frame {
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

  /** Hooks that will receive events; the built-in logger always runs first. */
  #activeHooks(): readonly NolaHook[] {
    return [builtinLogger(), ...(this.#config?.hooks ?? [])];
  }

  /**
   * Dispatch one event to every hook. Observers must never break resolution:
   * a throwing hook is swallowed and warned about once per (hook, method).
   */
  emitEvent<M extends HookMethod>(method: M, event: Parameters<NonNullable<NolaHook[M]>>[0]): void {
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
