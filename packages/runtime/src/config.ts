import { Codes } from "@nola-lang/ast";
import type {
  NolaCacheStore,
  NolaConfig,
  NolaHook,
  NolaLogLevel,
  NolaMiddleware,
  NolaProvider,
  UnderivableContextTypeMode,
} from "@nola-lang/core";
import { NolaConfigError } from "@nola-lang/core";
import { memoryCacheStore } from "./cache.js";

export interface ResolvedNolaConfig {
  providers: Readonly<Record<string, NolaProvider>>;
  forceProvider?: string;
  observability: Readonly<{ logLevel: NolaLogLevel }>;
  hooks: readonly NolaHook[];
  middleware: readonly NolaMiddleware[];
  /** present iff `cache` was configured; store always concrete (default in-memory) */
  cache?: Readonly<{ store: NolaCacheStore }>;
  /** present iff `system` was configured */
  system?: Readonly<{ message?: string }>;
  /** always present, defaults applied; timeoutMs 0 = disabled */
  ask: Readonly<{ timeoutMs: number }>;
  /** always present, defaults applied; the runtime itself never reads it */
  compiler: ResolvedCompilerConfig;
  /** always present, defaults applied; only `nola build` reads it */
  build: ResolvedBuildConfig;
}

/** Default per-invocation timeout when neither the intent nor ask.timeoutMs sets one. */
export const DEFAULT_ASK_TIMEOUT_MS = 60_000;

export type ResolvedCompilerConfig = Readonly<{ underivableContextType: UnderivableContextTypeMode }>;

export function defineConfig(config: NolaConfig): NolaConfig {
  return config;
}

const LOG_LEVELS: readonly NolaLogLevel[] = ["silent", "error", "warn", "info", "debug"];
const RESERVED_KEYS = ["plugins"] as const;
const ALLOWED_KEYS = new Set([
  "providers",
  "forceProvider",
  "observability",
  "hooks",
  "middleware",
  "cache",
  "system",
  "ask",
  "compiler",
  "build",
  ...RESERVED_KEYS,
]);
const HOOK_METHODS = [
  "onAskStart",
  "onProviderRequest",
  "onProviderResponse",
  "onValidationFailed",
  "onRetry",
  "onAskEnd",
  "onInvocationEnd",
] as const;

function fail(source: string | undefined, message: string, code: string = Codes.ConfigInvalid): never {
  throw new NolaConfigError(`${source ? `${source}: ` : ""}${message}`, code);
}

function validateHooks(source: string | undefined, raw: unknown): readonly NolaHook[] {
  if (raw === undefined) return Object.freeze([]);
  if (!Array.isArray(raw)) fail(source, "`hooks` must be an array of hook objects.");
  raw.forEach((entry, i) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      fail(source, `hooks[${i}] is not a hook object (need { onAskStart?, onAskEnd?, ... }).`);
    }
    for (const method of HOOK_METHODS) {
      const fn = (entry as Record<string, unknown>)[method];
      if (fn !== undefined && typeof fn !== "function") fail(source, `hooks[${i}].${method} must be a function.`);
    }
  });
  return Object.freeze([...(raw as NolaHook[])]);
}

function validateCache(source: string | undefined, raw: unknown): Readonly<{ store: NolaCacheStore }> | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail(
      source,
      "`cache` must be an object — write cache: {} or cache: { store: <NolaCacheStore> }.",
      Codes.CacheStoreInvalid,
    );
  }
  const store = (raw as Record<string, unknown>).store;
  if (store === undefined) return Object.freeze({ store: memoryCacheStore() });
  const s = store as { get?: unknown; set?: unknown } | null;
  if (!s || typeof s !== "object" || typeof s.get !== "function" || typeof s.set !== "function") {
    fail(
      source,
      "cache.store is not a NolaCacheStore (need { get(fingerprint), set(fingerprint, value) }).",
      Codes.CacheStoreInvalid,
    );
  }
  return Object.freeze({ store: store as NolaCacheStore });
}

function validateAsk(source: string | undefined, raw: unknown): Readonly<{ timeoutMs: number }> {
  if (raw === undefined) return Object.freeze({ timeoutMs: DEFAULT_ASK_TIMEOUT_MS });
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail(source, "`ask` must be an object — write ask: { timeoutMs: 60000 }.");
  }
  const cfg = raw as Record<string, unknown>;
  for (const key of Object.keys(cfg)) {
    if (key !== "timeoutMs") fail(source, `unknown ask config key \`${key}\` — allowed keys: timeoutMs.`);
  }
  const timeoutMs = cfg.timeoutMs;
  if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs < 0)) {
    fail(source, "ask.timeoutMs must be a non-negative finite number of milliseconds (0 disables the timeout).");
  }
  return Object.freeze({ timeoutMs: (timeoutMs as number | undefined) ?? DEFAULT_ASK_TIMEOUT_MS });
}

function validateSystem(source: string | undefined, raw: unknown): Readonly<{ message?: string }> | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail(source, '`system` must be an object — write system: { message: "..." }.');
  }
  const message = (raw as Record<string, unknown>).message;
  if (message !== undefined && typeof message !== "string") {
    fail(source, "system.message must be a string.");
  }
  return Object.freeze({ message: message as string | undefined });
}

const CONTEXT_TYPE_MODES: readonly UnderivableContextTypeMode[] = ["error", "prune", "omit"];

/**
 * Validate the compile-time section and apply defaults. Exported separately:
 * the loader's `loadCompilerOptions` validates a config's `compiler` section
 * for build/check without demanding a runtime-valid config around it.
 */
export function resolveCompilerConfig(raw: unknown, source?: string): ResolvedCompilerConfig {
  if (raw === undefined) return Object.freeze({ underivableContextType: "error" as const });
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail(source, '`compiler` must be an object — write compiler: { underivableContextType: "prune" }.');
  }
  const cfg = raw as Record<string, unknown>;
  for (const key of Object.keys(cfg)) {
    if (key !== "underivableContextType") {
      fail(source, `unknown compiler config key \`${key}\` — allowed keys: underivableContextType.`);
    }
  }
  const mode = cfg.underivableContextType;
  if (mode !== undefined && (typeof mode !== "string" || !CONTEXT_TYPE_MODES.includes(mode as never))) {
    fail(source, `compiler.underivableContextType must be one of ${CONTEXT_TYPE_MODES.join(", ")}.`);
  }
  return Object.freeze({ underivableContextType: (mode as UnderivableContextTypeMode | undefined) ?? "error" });
}

export type ResolvedBuildConfig = Readonly<{ target: "app" | "lib" }>;

const BUILD_TARGETS = ["app", "lib"] as const;

/**
 * Validate the build-time section and apply defaults. Exported separately:
 * the loader's `loadBuildOptions` validates a config's `build` section for
 * `nola build` without demanding a runtime-valid config around it.
 */
export function resolveBuildConfig(raw: unknown, source?: string): ResolvedBuildConfig {
  if (raw === undefined) return Object.freeze({ target: "app" as const });
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail(source, '`build` must be an object — write build: { target: "lib" }.');
  }
  const cfg = raw as Record<string, unknown>;
  for (const key of Object.keys(cfg)) {
    if (key !== "target") fail(source, `unknown build config key \`${key}\` — allowed keys: target.`);
  }
  const target = cfg.target;
  if (target !== undefined && (typeof target !== "string" || !BUILD_TARGETS.includes(target as never))) {
    fail(source, `build.target must be one of ${BUILD_TARGETS.join(", ")}.`);
  }
  return Object.freeze({ target: (target as "app" | "lib" | undefined) ?? "app" });
}

function validateMiddleware(source: string | undefined, raw: unknown): readonly NolaMiddleware[] {
  if (raw === undefined) return Object.freeze([]);
  if (!Array.isArray(raw)) fail(source, "`middleware` must be an array of functions.");
  raw.forEach((entry, i) => {
    if (typeof entry !== "function") fail(source, `middleware[${i}] is not a function.`);
  });
  return Object.freeze([...(raw as NolaMiddleware[])]);
}

/** Validate a raw config value and freeze it. Idempotent on already-resolved configs. */
export function resolveNolaConfig(raw: unknown, opts: { source?: string } = {}): ResolvedNolaConfig {
  const { source } = opts;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail(source, "config must be an object — export default defineConfig({ providers: { default: <provider> } }).");
  }
  const cfg = raw as Record<string, unknown>;
  if ("provider" in cfg) {
    fail(source, "`provider` was replaced by `providers` — write providers: { default: <your provider> }.");
  }
  for (const key of RESERVED_KEYS) {
    if (cfg[key] !== undefined)
      fail(source, `\`${key}\` is reserved for a future Nola version.`, Codes.ConfigReservedKey);
  }
  for (const key of Object.keys(cfg)) {
    if (!ALLOWED_KEYS.has(key)) {
      fail(
        source,
        `unknown config key \`${key}\` — allowed keys: providers, forceProvider, observability, hooks, middleware, cache, system, ask, compiler, build.`,
      );
    }
  }
  const providers = cfg.providers;
  if (providers === null || typeof providers !== "object" || Array.isArray(providers)) {
    fail(source, "`providers` must be an object with at least a `default` entry.");
  }
  const map = providers as Record<string, unknown>;
  const names = Object.keys(map);
  if (!("default" in map)) fail(source, "`providers` must include a `default` entry.");
  for (const [name, value] of Object.entries(map)) {
    const p = value as { name?: unknown; complete?: unknown } | null;
    if (!p || typeof p !== "object" || typeof p.name !== "string" || typeof p.complete !== "function") {
      fail(source, `providers.${name} is not a NolaProvider (need { name: string, complete(req) }).`);
    }
  }
  if (cfg.forceProvider !== undefined) {
    if (typeof cfg.forceProvider !== "string" || !(cfg.forceProvider in map)) {
      fail(
        source,
        `forceProvider ${JSON.stringify(cfg.forceProvider)} does not name a configured provider — configured: ${names.join(", ")}.`,
        Codes.ConfigUnknownProvider,
      );
    }
  }
  let logLevel: NolaLogLevel = "warn";
  if (cfg.observability !== undefined) {
    const obs = cfg.observability;
    if (obs === null || typeof obs !== "object") fail(source, "`observability` must be an object.");
    const level = (obs as Record<string, unknown>).logLevel;
    if (level !== undefined) {
      if (typeof level !== "string" || !LOG_LEVELS.includes(level as NolaLogLevel)) {
        fail(source, `observability.logLevel must be one of ${LOG_LEVELS.join(", ")}.`);
      }
      logLevel = level as NolaLogLevel;
    }
  }
  const hooks = validateHooks(source, cfg.hooks);
  const middleware = validateMiddleware(source, cfg.middleware);
  const cache = validateCache(source, cfg.cache);
  const system = validateSystem(source, cfg.system);
  const ask = validateAsk(source, cfg.ask);
  const compiler = resolveCompilerConfig(cfg.compiler, source);
  const build = resolveBuildConfig(cfg.build, source);
  return Object.freeze({
    providers: Object.freeze({ ...(map as Record<string, NolaProvider>) }),
    forceProvider: cfg.forceProvider as string | undefined,
    observability: Object.freeze({ logLevel }),
    hooks,
    middleware,
    cache,
    system,
    ask,
    compiler,
    build,
  });
}
