import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Codes } from "@nola-lang/ast";
import type {
  LanguageModel,
  ModelConfigEntry,
  NolaCacheStore,
  NolaConfig,
  NolaLogLevel,
  NolaMiddleware,
  NolaTelemetry,
  UnderivableContextTypeMode,
} from "@nola-lang/core";
import { isPlatformModel, NolaConfigError } from "@nola-lang/core";
import { memoryCacheStore } from "./cache.js";
import { terminalTrace } from "./terminal-trace.js";
import { TRACER_HOOK, tracer } from "./tracer.js";

export interface ResolvedNolaConfig {
  /** always the normalized map — a bare `model` resolves to `{ default }` */
  model: Readonly<Record<string, ModelConfigEntry>>;
  /**
   * The app's project name — rides trace envelopes and platform infer
   * requests (never the fingerprint). Explicit config wins; otherwise the
   * nearest package.json `name` walking up from the working directory;
   * absent when neither exists.
   */
  project?: string;
  forceModel?: string;
  /** The observer list in order — `console` already converted to the terminal sink; the NOLA_TRACING_URL tracer appended when the variable applies. */
  telemetry: readonly NolaTelemetry[];
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
  "model",
  "project",
  "forceModel",
  "telemetry",
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
  "onInvocationStart",
  "onInvocationEnd",
] as const;

function fail(source: string | undefined, message: string, code: string = Codes.ConfigInvalid): never {
  throw new NolaConfigError(`${source ? `${source}: ` : ""}${message}`, code);
}

/**
 * The default project name: the nearest package.json `name`, walking up from
 * the working directory. A package.json without a usable name keeps walking;
 * no hit anywhere means no project (everything downstream omits it).
 */
function defaultProject(): string | undefined {
  let dir = process.cwd();
  for (;;) {
    try {
      const name = (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: unknown }).name;
      if (typeof name === "string" && name.trim() !== "") return name;
    } catch {
      // no package.json here (or unreadable/invalid) — keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function validateProject(source: string | undefined, raw: unknown): string | undefined {
  if (raw === undefined) return defaultProject();
  if (typeof raw !== "string" || raw.trim() === "") {
    fail(source, "`project` must be a non-empty string — it names this app in traces and managed requests.");
  }
  return raw;
}

const TELEMETRY_SHAPE =
  "`telemetry` must be { level } (the terminal), an observer, or an array of observers — e.g. { level: \"info\" } or [nola.tracer(), terminalTrace()].";

function hasObserverMethod(source: string | undefined, entry: Record<string, unknown>, label: string): boolean {
  let any = false;
  for (const method of HOOK_METHODS) {
    const fn = entry[method];
    if (fn === undefined) continue;
    if (typeof fn !== "function") fail(source, `${label}.${method} must be a function.`);
    any = true;
  }
  return any;
}

/**
 * `telemetry` (config v2 §3, amended 2026-09-08): `{ level? }` is the
 * terminal alone; one observer or an array of observers replaces it and
 * implies nothing else. Absent = `{}` = `terminalTrace()` (every event, at
 * `debug`); `[]` = silent.
 */
function validateTelemetry(source: string | undefined, raw: unknown): readonly NolaTelemetry[] {
  if (raw === undefined) return Object.freeze([terminalTrace()]);
  if (Array.isArray(raw)) {
    const out = raw.map((entry, i): NolaTelemetry => {
      const label = `telemetry[${i}]`;
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        fail(source, `${label} is not an observer (need an object with at least one on* method; the terminal is terminalTrace({ level })).`);
      }
      if (!hasObserverMethod(source, entry as Record<string, unknown>, label)) {
        fail(source, `${label} is not an observer (need an object with at least one on* method; the terminal is terminalTrace({ level })).`);
      }
      return entry as NolaTelemetry;
    });
    return Object.freeze(out);
  }
  if (raw === null || typeof raw !== "object") fail(source, TELEMETRY_SHAPE);
  const obj = raw as Record<string, unknown>;
  if (hasObserverMethod(source, obj, "telemetry")) return Object.freeze([obj as NolaTelemetry]);
  for (const key of Object.keys(obj)) {
    if (key !== "level") fail(source, `telemetry.${key} is not a terminal option — ${TELEMETRY_SHAPE}`);
  }
  const level = obj.level;
  if (level !== undefined && (typeof level !== "string" || !LOG_LEVELS.includes(level as NolaLogLevel))) {
    fail(source, `telemetry.level must be one of ${LOG_LEVELS.join(", ")}.`);
  }
  return Object.freeze([terminalTrace(level === undefined ? {} : { level: level as NolaLogLevel })]);
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

function isModelShaped(value: unknown): value is LanguageModel {
  const m = value as { name?: unknown; complete?: unknown } | null;
  return !!m && typeof m === "object" && typeof m.name === "string" && typeof m.complete === "function";
}

/** Rejects a string in the slot with its fix; returns the value otherwise. */
function admitModelValue(source: string | undefined, value: unknown, label: string): unknown {
  if (typeof value === "string") {
    fail(
      source,
      `${label}: a string is not a model — import a provider factory from @nola-lang/providers (e.g. openai("gpt-5-mini")), or use nola.infer("<provider>/<model>") for a platform-served upstream.`,
    );
  }
  return value;
}

/**
 * `model` accepts a bare LanguageModel (→ { default }), the platform model
 * `nola.infer()` (bare or as the map's `default` — root-only), or a named
 * map that must carry `default`. The platform model nested anywhere else is
 * the position error.
 */
function normalizeModelMap(source: string | undefined, raw: unknown): Record<string, ModelConfigEntry> {
  const bare = admitModelValue(source, raw, "`model`");
  if (isPlatformModel(bare)) return { default: bare };
  if (isModelShaped(bare)) return { default: bare };
  if (bare === null || typeof bare !== "object" || Array.isArray(bare)) {
    fail(
      source,
      "`model` must be a model (need { name: string, complete(req) } — a provider factory result, or nola.infer()), or a map with at least a `default` entry.",
    );
  }
  const map = bare as Record<string, unknown>;
  if (!("default" in map)) fail(source, "a `model` map must include a `default` entry.");
  const out: Record<string, ModelConfigEntry> = {};
  for (const [name, value] of Object.entries(map)) {
    const entry = admitModelValue(source, value, `model.${name}`);
    if (isPlatformModel(entry)) {
      if (name !== "default") {
        fail(
          source,
          `model.${name}: the platform model can only be the root \`default\` — route locally with provider-factory models, or put \`nola.infer()\` in \`default\`.`,
        );
      }
      out[name] = entry;
      continue;
    }
    if (!isModelShaped(entry)) fail(source, `model.${name} is not a model (need { name: string, complete(req) }).`);
    out[name] = entry;
  }
  return out;
}

/** Marks a config `resolveNolaConfig` produced, so re-resolution neither re-applies nor re-notices the env tracer. */
const RESOLVED: unique symbol = Symbol.for("nola.resolvedConfig");

let tracingEnvIgnoredNoticed = false;
function noticeTracingEnvIgnored(): void {
  if (tracingEnvIgnoredNoticed) return;
  tracingEnvIgnoredNoticed = true;
  console.warn("[nola] NOLA_TRACING_URL ignored — nola.config.ts lists a nola.tracer() entry.");
}

/** Validate a raw config value and freeze it. Idempotent on already-resolved configs. */
export function resolveNolaConfig(raw: unknown, opts: { source?: string } = {}): ResolvedNolaConfig {
  const { source } = opts;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail(source, "config must be an object — export default defineConfig({ model: <model> }).");
  }
  const cfg = raw as Record<string, unknown>;
  for (const key of RESERVED_KEYS) {
    if (cfg[key] !== undefined)
      fail(source, `\`${key}\` is reserved for a future Nola version.`, Codes.ConfigReservedKey);
  }
  if (cfg.hooks !== undefined) {
    fail(
      source,
      "unknown config key `hooks` — observers are listed under `telemetry` ({ level } for the terminal, or a tracer / an object with on* methods).",
    );
  }
  for (const key of Object.keys(cfg)) {
    if (!ALLOWED_KEYS.has(key)) {
      fail(
        source,
        `unknown config key \`${key}\` — allowed keys: model, project, forceModel, telemetry, middleware, cache, system, ask, compiler, build.`,
      );
    }
  }
  const map = normalizeModelMap(source, cfg.model);
  const project = validateProject(source, cfg.project);
  const names = Object.keys(map);
  if (cfg.forceModel !== undefined) {
    if (typeof cfg.forceModel !== "string" || !(cfg.forceModel in map)) {
      fail(
        source,
        `forceModel ${JSON.stringify(cfg.forceModel)} does not name a configured model — configured: ${names.join(", ")}.`,
        Codes.ConfigUnknownModel,
      );
    }
  }
  // NOLA_TRACING_URL = "append the default tracer": it yields, with one
  // notice, to a tracer the config lists itself. A resolved config is left
  // alone — its env tracer is already there.
  let telemetry = validateTelemetry(source, cfg.telemetry);
  const envUrl = process.env.NOLA_TRACING_URL;
  const alreadyResolved = (cfg as { [RESOLVED]?: unknown })[RESOLVED] === true;
  if (envUrl && !alreadyResolved) {
    if (telemetry.some((t) => t.name === TRACER_HOOK)) {
      noticeTracingEnvIgnored();
    } else {
      telemetry = Object.freeze([...telemetry, tracer(envUrl)]);
    }
  }
  const middleware = validateMiddleware(source, cfg.middleware);
  const cache = validateCache(source, cfg.cache);
  const system = validateSystem(source, cfg.system);
  const ask = validateAsk(source, cfg.ask);
  const compiler = resolveCompilerConfig(cfg.compiler, source);
  const build = resolveBuildConfig(cfg.build, source);
  return Object.freeze({
    [RESOLVED]: true,
    model: Object.freeze({ ...map }),
    ...(project !== undefined ? { project } : {}),
    forceModel: cfg.forceModel as string | undefined,
    telemetry,
    middleware,
    cache,
    system,
    ask,
    compiler,
    build,
  });
}
