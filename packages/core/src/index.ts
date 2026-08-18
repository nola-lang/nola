export type JsonSchema =
  | {
    type: "string";
    enum?: string[];
    /** wire convention for revived types (e.g. Date); validator enforces parseability */
    format?: "date-time";
    description?: string;
    $defs?: Record<string, JsonSchema>;
  }
  | { type: "number" | "boolean"; description?: string; $defs?: Record<string, JsonSchema> }
  | { type: "array"; items: JsonSchema; description?: string; $defs?: Record<string, JsonSchema> }
  | {
    type: "object";
    properties: Record<string, JsonSchema>;
    required: string[];
    additionalProperties: false;
    description?: string;
    $defs?: Record<string, JsonSchema>;
  }
  | { $ref: string; description?: string; $defs?: Record<string, JsonSchema> };

export const INTENT_BRAND = "nola.intent" as const;

/**
 * The site of an ask: project-relative display file + "line:col"
 * (both 1-based; "?" when the site is unknown). The human-facing form is
 * `file:line:col`. Frozen and JSON-serializable ({ file, loc }).
 */
export class Site {
  constructor(
    readonly file: string,
    readonly loc: string,
  ) {
    Object.freeze(this);
  }

  toString(): string {
    return `${this.file}:${this.loc}`;
  }

  /**
   * Strict inverse of toString(). loc is matched from the right ("line:col"
   * or "?"), so a file path containing ":" cannot confuse it. Throws on
   * anything else — parse failures are programmer errors, not NOLA codes.
   */
  static parse(text: string): Site {
    const m = /^([\s\S]+):(\d+:\d+|\?)$/.exec(text);
    if (!m) throw new Error(`not a source location: ${text}`);
    return new Site(m[1] as string, m[2] as string);
  }
}

/**
 * The emit contract between compiler output and the `__nola` runtime
 * namespace. Bump ONLY when the lowered-code ↔ runtime contract changes
 * shape or semantics (new/renamed factory or helper, changed argument
 * meaning, changed context protocol). Routine releases leave it alone.
 * The surface-snapshot test in packages/runtime/test/emit-surface.test.ts
 * fails when the surface changes without a bump.
 * Emit 5: ask-site schemas are `__nola.types` combinator expressions
 * (InferType carrier) with per-file `__nola_type_<Name>` accessors in the
 * EOF appendix; recursion is legal via named refs ($defs/$ref).
 * Emit 6: `__nola.types.unsupported` (companion modules for cross-file types).
 * Emit 7: ExtractIntent's init renames — the InferType expression moves under
 * `type` (was `schema` — a misnomer since the emit-5 carrier switch) and the
 * backtick text under `instruction` (was `message`), unifying the name for
 * authored backtick text across intents and the infer-function scope.
 * Emit 8: function scopes come from `__nola_file_ctx().func({ fn, instruction,
 * args })` with harvested params; the file accessor moves under
 * `__nola.context.file`.
 * Emit 9: `__nola.types.date` — `Date` lowers to a string schema carrying
 * format: "date-time"; the intent revives the wire string to a Date.
 */
export const NOLA_EMIT = 11;

/**
 * The narrow public tier: an intent resolvable ONLY through `ask` — what a
 * raw `..` extractor or call intent is. Not thenable (bare await/run on one
 * throws NOLA3010 at runtime, so the type does not offer it) and no
 * root-only knobs (timeout/detached act when an intent roots an invocation,
 * which these never do). The fluent methods clone.
 *
 * T is deliberately phantom — it appears only in the fluent returns, so
 * differently-parameterized Askables collapse structurally. Any member that
 * used T (even symbol-keyed) would surface in editor completion, and a clean
 * completion list IS this interface's purpose; `ask` still infers T from the
 * type reference (or, for class-typed operands, through the class's `then`).
 */
export interface Askable<T = unknown> {
  /** extra whole-ask attempts, flat (no backoff) — unrelated to the provider-level `withRetry` combinator */
  withRetry(retries: number): Askable<T>;
  withProvider(provider: ProviderRef): Askable<T>;
  /** wire-tuning knobs, shallow-merged over any params already on the intent */
  withParams(params: ProviderParams): Askable<T>;
}

/**
 * A lazy, thenable intent (the async/await analogy) — what calling an infer
 * function returns. `ask`/`await` resolves it to `T`; the fluent methods
 * clone. Implemented as a class in `@nola-lang/runtime` (the class carries
 * the runtime `__nolaBrand`; the public type deliberately does not); not
 * JSON-serializable (it holds an executor closure).
 */
export interface Intent<T = unknown> extends Askable<T>, PromiseLike<T> {
  /** extra whole-ask attempts, flat (no backoff) — unrelated to the provider-level `withRetry` combinator */
  withRetry(retries: number): Intent<T>;
  withProvider(provider: ProviderRef): Intent<T>;
  /** per-invocation timeout in ms when this intent roots the invocation; 0 disables */
  withTimeout(timeout: number): Intent<T>;
  /** wire-tuning knobs, shallow-merged over any params already on the intent */
  withParams(params: ProviderParams): Intent<T>;
  /** resolve without inheriting the caller frame's context (stack-frame opt-out) */
  detached(): Intent<T>;
}

export type Message = { role: "user" | "assistant"; content: string };

export type JsonProviderOutput = {
  /** wire syntax of the expected reply text */
  syntax: "json";
  /** contract for the parsed value; absent = any value / free text */
  schema?: JsonSchema;
}
export type CodeProviderOutput = {
  syntax: "code";
  /** syntax "code" only: fence language hint ("ts", "sql", …) */
  language?: string;
};


export type ProviderOutput = JsonProviderOutput | CodeProviderOutput;

/**
 * Wire-tuning knobs an intent can set (.withParams). Absent fields mean
 * "provider default". Part of the ask fingerprint — two asks differing only
 * in params never share a cache/replay entry.
 */
export interface ProviderParams {
  temperature?: number;
  maxOutputTokens?: number;
  /**
   * Opaque provider-specific knobs (reasoning budget, top_p, penalties, …) —
   * passed through to NolaProvider.complete untouched. Merged per key like
   * the typed fields; must be JSON-serializable (it joins the fingerprint).
   */
  providerOptions?: Record<string, unknown>;
}

/**
 * The one merge rule for ProviderParams: patch fields win per field, and
 * providerOptions merges per key rather than being replaced wholesale. Used
 * by .withParams() chaining and by frame-chain resolution.
 */
export function mergeProviderParams(
  base?: ProviderParams,
  patch?: ProviderParams,
): ProviderParams | undefined {
  if (!base || !patch) return patch ?? base;
  const merged: ProviderParams = { ...base, ...patch };
  if (base.providerOptions && patch.providerOptions) {
    merged.providerOptions = { ...base.providerOptions, ...patch.providerOptions };
  }
  return merged;
}

export interface ProviderRequest {
  system: string;
  messages: Message[];
  output: ProviderOutput;
  params?: ProviderParams;
  signal?: AbortSignal;
}

export type ProviderResponse = {
  text: string;
  durationMs?: number;
}

export interface NolaProvider {
  name: string;
  complete(req: ProviderRequest): Promise<ProviderResponse>;
}

export type ProviderRef = NolaProvider | string;

export type NolaLogLevel = "silent" | "error" | "warn" | "info" | "debug";

export interface AskReceipt {
  askId: string;
  site: Site;
  /** the composed conversation as first composed for this ask */
  originalPrompt: string;
  /** as last sent to the provider — diverges on a correction retry (and future middleware rewrites) */
  effectivePrompt: string;
  schema: JsonSchema;
  /** provider name, or a middleware label such as "cache" on a short-circuit */
  servedBy: string;
  /** provider round trips actually performed (0 on a short-circuit) */
  attempts: number;
  outcome: { ok: true; value: unknown } | { ok: false; error: string };
  usage?: { inputTokens?: number; outputTokens?: number };
  durationMs: number;
  meta: Record<string, unknown>;
  /** invocation this ask belongs to (absent only for legacy synthesized receipts) */
  invocationId?: string;
  /** invocationIds from root frame to owning frame */
  spanPath?: readonly string[];
  /** canonical ask fingerprint (absent when a middleware short-circuited before the terminal) */
  fingerprint?: string;
}

export interface AttemptRecord {
  attempt: number;
  provider: string;
  durationMs: number;
  validationError?: string;
}

export interface AskSpanTrace {
  kind: "ask";
  askId: string;
  site: Site;
  originalPrompt: string;
  effectivePrompt: string;
  schema: JsonSchema;
  attempts: AttemptRecord[];
  servedBy: string;
  outcome: { ok: true; value: unknown } | { ok: false; error: string };
  durationMs: number;
  fingerprint?: string;
}

export interface InvocationTrace {
  kind: "invocation";
  invocationId: string;
  fn: string;
  file: string;
  spans: Array<AskSpanTrace | InvocationTrace>;
}

export interface AskStartEvent {
  readonly askId: string;
  readonly site: Site;
  // readonly originalPrompt: string;
  // readonly schema: JsonSchema;
  readonly provider: string;
}

export interface ProviderRequestEvent {
  readonly askId: string;
  readonly attempt: number;
  readonly provider: string;
  readonly messages: ReadonlyArray<{ role: "user" | "assistant"; content: string }>;
}

export interface ProviderResponseEvent {
  readonly askId: string;
  readonly attempt: number;
  readonly provider: string;
  readonly text: string;
  readonly durationMs: number;
}

export interface ValidationFailedEvent {
  readonly askId: string;
  readonly attempt: number;
  readonly error: string;
  readonly site: Site;
}

export interface RetryEvent {
  readonly askId: string;
  readonly attempt: number;
  readonly reason: string;
  readonly site: Site;
}

export interface AskEndEvent {
  readonly askId: string;
  readonly receipt: AskReceipt;
}

export interface InvocationEndEvent {
  readonly invocationId: string;
  readonly trace: InvocationTrace;
}

/**
 * Observers. Fed from fixed points OUTSIDE the middleware pipeline, so middleware
 * cannot suppress them. Hooks may not mutate payloads or short-circuit; a throwing
 * hook is swallowed with one warning.
 */
export interface NolaHook {
  name?: string;
  onAskStart?(event: AskStartEvent): void;
  onProviderRequest?(event: ProviderRequestEvent): void;
  onProviderResponse?(event: ProviderResponseEvent): void;
  onValidationFailed?(event: ValidationFailedEvent): void;
  onRetry?(event: RetryEvent): void;
  onAskEnd?(event: AskEndEvent): void;
  onInvocationEnd?(event: InvocationEndEvent): void;
}

/**
 * The mutable state of one ask as it travels the middleware pipeline.
 * Runtime-owned fields are readonly at the type level and frozen at runtime:
 * assigning to them is a compile error AND a TypeError.
 */
export interface AskContext {
  readonly askId: string;
  readonly site: Site;
  // readonly schema: JsonSchema;
  // readonly originalPrompt: string;
  readonly abortSignal: AbortSignal;
  /** effective prompt; starts equal to originalPrompt */
  // prompt: string;
  /** re-route before the wire; ignored when config.forceProvider is set */
  provider?: ProviderRef;
  /** cross-stage scratch; lands in the receipt */
  meta: Record<string, unknown>;
}

export interface AskResult {
  /** must validate against ctx.schema, including on a short-circuit */
  value: unknown;
  /** provider name, or a middleware label such as "cache" */
  servedBy: string;
}

/** In the call path: may mutate, short-circuit (return without calling next), or throw. */
export type NolaMiddleware = (ctx: AskContext, next: (ctx: AskContext) => Promise<AskResult>) => Promise<AskResult>;

/** Fingerprint-keyed cache. get() returning undefined means miss (values are JSON, never undefined). */
export interface NolaCacheStore {
  get(fingerprint: string): unknown | Promise<unknown>;
  set(fingerprint: string, value: unknown): void | Promise<void>;
}

/**
 * What the lowering does when a `..`-contextual parameter's type cannot be
 * derived into an intent schema: fail the compile, drop just the underivable
 * members (keeping the rest of the type), or drop the whole type silently.
 */
export type UnderivableContextTypeMode = "error" | "prune" | "omit";

/** Compile-time behavior. Read by `nola build`/`check` and the loader; the runtime ignores it. */
export interface NolaCompilerConfig {
  /** Policy for underivable `..`-contextual parameter types. Default: "error". */
  underivableContextType?: UnderivableContextTypeMode;
}

/** Build-time behavior. Read by `nola build`; never by the runtime or the loader hooks. */
export interface NolaBuildConfig {
  /**
   * "app" (default): `nola build` bundles nola.config.ts into --out as a
   * self-configuring module and wires every lowered file to import it.
   * "lib": pure lowered JS — the consuming app's process supplies the config.
   */
  target?: "app" | "lib";
}

export interface NolaConfig {
  /** Named providers. `default` is required; other names are user-chosen. */
  providers: { default: NolaProvider } & Record<string, NolaProvider>;
  /**
   * Hermetic force-all override: when set, EVERY ask resolves through this
   * provider, including intents pinned with .withProvider(). Must name a key
   * of `providers`. Drive it from env: `process.env.CI ? "mock" : undefined`.
   */
  forceProvider?: string;
  observability?: { logLevel?: NolaLogLevel };
  /** Ordered pipeline around every resolution; the first entry is outermost. */
  middleware?: NolaMiddleware[];
  /** Observers; all hooks receive all events. Order is not meaningful. */
  hooks?: NolaHook[];
  /** Opt-in ask cache keyed by canonical fingerprint. Omit `store` for in-memory. */
  cache?: { store?: NolaCacheStore };
  /** Extra system-prompt text, composed after the Nola protocol preamble on every ask. */
  system?: { message?: string };
  /**
   * Ask-path knobs. timeoutMs is the default per-invocation timeout in
   * milliseconds — the root frame's abort signal fires when it elapses; every
   * provider call receives that signal. 0 disables. Intents override it with
   * .withTimeout(ms).
   */
  ask?: { timeoutMs?: number };
  /** Compile-time behavior; validated here, consumed by build/check/loader — never by the runtime. */
  compiler?: NolaCompilerConfig;
  /** Build-time behavior; validated here, consumed by `nola build` — never by the runtime. */
  build?: NolaBuildConfig;
  /** Reserved for a future Nola version. Rejected at load. */
  plugins?: never;
}

/**
 * One completed ask as later prompts may see it. Lives in core (not the
 * runtime's Frame) because fingerprinting hashes history and providers
 * (record/replay) consume fingerprints — neither may depend on the runtime.
 */
export interface HistoryRecord {
  prompt: string;
  /** what the program received */
  value: unknown;
  /** what subsequent prompts see; reserved — no user API sets it in Phase 1 */
  promptValue?: unknown;
}

export {
  NolaConfigError,
  NolaIntentError,
  NolaProviderError,
  NolaResolutionError,
  NolaSchemaError,
  NolaVersionError,
  type ProviderErrorOptions,
  type ResolutionDetails,
  type VersionDetails,
} from "./errors.js";
export {
  type AskFingerprintInput,
  canonicalize,
  FINGERPRINT_VERSION,
  fingerprintAsk,
  fingerprintRequest,
  sha256Hex,
} from "./fingerprint.js";
export { redactError, redactSecrets } from "./redact.js";
