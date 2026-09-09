import type {
  InferenceModel,
  InferRequest,
  NolaErrorResponse,
  NolaInferRequest,
  NolaInferResponse,
  PlatformModel,
  ProviderResponse,
} from "@nola-lang/core";
import { NOLA_API_URL, NOLA_PROTOCOL, NOLA_USAGE_HEADERS, NolaProviderError, PLATFORM_MODEL, parseRetryAfter } from "@nola-lang/core";
import { NOLA_VERSION } from "./version.js";


export { NOLA_PROTOCOL } from "@nola-lang/core";
export { NOLA_VERSION } from "./version.js";
export type { PlatformModel };

/** Options of the platform connection — what `nola.infer({...})` and `nola.tracer({...})` take. */
export interface PlatformOptions {
  apiKey?: string;
  /** Env var name holding the key. Default: "NOLA_API_KEY". Value is read lazily at the first request. */
  apiKeyEnv?: string;
  /** Default: NOLA_API_URL env var, else "https://api.nola.sh". Read lazily at the first request. */
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  /** Built-in wire-level retry. Default: 2 retries, 500 ms exponential backoff ×2 capped at 10 s, honoring Retry-After; skips definitive errors. `false` disables. */
  retry?: false | { maxRetries?: number; delayMs?: number; multiplier?: number; maxDelayMs?: number };
}

/** With this many free runs left (or fewer) the model prints the usage line — once per distinct count, and only while the free runs are what is being spent. */
export const LOW_RUNS_NOTICE = 5;

/** The base URL rule shared by the model client and the platform tracer (an empty string counts as absent). */
export function resolvePlatformBaseUrl(options: { baseUrl?: string }): string {
  return (options.baseUrl || process.env.NOLA_API_URL || NOLA_API_URL).replace(/\/$/, "");
}

/** 4xx other than 408/429 cannot be fixed by retrying the same request. */
function isDefinitiveStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/** The hosted API's `{ error: { code, message, details? } }` body, or undefined for anything else. */
function parseErrorBody(text: string): NolaErrorResponse["error"] | undefined {
  try {
    const parsed = JSON.parse(text) as Partial<NolaErrorResponse> | null;
    const e = parsed?.error;
    if (e && typeof e === "object" && typeof e.code === "string" && typeof e.message === "string") {
      const details = e.details;
      return {
        code: e.code,
        message: e.message,
        ...(details && typeof details === "object" && !Array.isArray(details) ? { details } : {}),
      };
    }
  } catch {
    // not JSON — the generic message below carries the body
  }
  return undefined;
}

/**
 * Protocol 1 wire compatibility: the deployed `/v1/infer` validator pins
 * `intent: "extract"` and knows no `callee`/`hint`, so a call intent's model
 * is POSTed in the extract shape — the instruction already carries the
 * synthesized request, and the server treats both kinds alike today.
 * Receipts, hook events and the console keep the real kind. Lift once the
 * platform accepts "call" (handoff 2026-09-07-infer-intent-call.md).
 */
function toWireIntent(model: InferenceModel): InferenceModel {
  if (model.intent !== "call") return model;
  const { instruction, text } = model.input;
  return { ...model, intent: "extract", input: { instruction, ...(text !== undefined ? { text } : {}) } };
}

/**
 * The platform-served model: a Nola Protocol `/v1/infer` client — users
 * reach it through `nola.infer()` (config v2 §2: no argument, a
 * "<provider>/<model>" selector, or the connection options).
 * `infer` consumes the canonical InferenceModel — the server composes
 * prompts itself — and replies `{ text }` like every model, so the runtime's
 * parse/validate/correction loop is shared unchanged. Server errors arrive as
 * `{ error: { code, message, details } }` and surface verbatim on
 * NolaProviderError (`code`/`details`).
 */
export function platformModel(options: PlatformOptions & { model?: string }): PlatformModel {
  const doFetch = options.fetch ?? globalThis.fetch;
  const noticed = new Set<number>();
  const retry =
    options.retry === false
      ? { maxRetries: 0, delayMs: 0, multiplier: 1, maxDelayMs: 0 }
      : {
          maxRetries: options.retry?.maxRetries ?? 2,
          delayMs: options.retry?.delayMs ?? 500,
          multiplier: options.retry?.multiplier ?? 2,
          maxDelayMs: options.retry?.maxDelayMs ?? 10_000,
        };
  const sleep = (ms: number): Promise<void> =>
    ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

  const noticeUsage = (headers: Headers): void => {
    // the run counter arrives in every mode; the balance header marks paid mode, where credit is being spent and the free runs are not the story
    if (headers.get(NOLA_USAGE_HEADERS.balance) !== null) return;
    const usedText = headers.get(NOLA_USAGE_HEADERS.used);
    const limitText = headers.get(NOLA_USAGE_HEADERS.limit);
    if (usedText === null || limitText === null) return;
    const used = Number(usedText);
    const limit = Number(limitText);
    if (!Number.isFinite(used) || !Number.isFinite(limit)) return;
    const left = limit - used;
    if (left > LOW_RUNS_NOTICE || noticed.has(used)) return;
    noticed.add(used);
    console.warn(`Nola free usage: ${used} / ${limit} runs — ${Math.max(0, left)} left. Run \`nola account\` to add credits.`);
  };

  const attemptOnce = async (req: InferRequest): Promise<ProviderResponse> => {
    const requestedAt = Date.now();
    const envName = options.apiKeyEnv ?? "NOLA_API_KEY";
    const apiKey = options.apiKey ?? process.env[envName];
    if (!apiKey) {
      throw new NolaProviderError(
        `Nola API key not found: environment variable ${envName} is not set (checked process.env, including the project .env applied by the Nola loader) and no \`apiKey\` was passed to nola.infer(). Fix: set ${envName}, or pass nola.infer({ apiKeyEnv: "MY_VAR" }) or nola.infer({ apiKey }) in nola.config.ts. Get a free key with \`npx nola-lang key\` (or \`npm create nola\` for a new project), or bring your own model in nola.config.ts (https://nola.sh/docs/reference/providers-api/).`,
        { definitive: true },
      );
    }
    const baseUrl = resolvePlatformBaseUrl(options);
    const body: NolaInferRequest = {
      protocol: NOLA_PROTOCOL,
      version: NOLA_VERSION,
      ...(req.trace ? { askId: req.trace.askId, invocationId: req.trace.invocationId, spanPath: req.trace.spanPath } : {}),
      intent: toWireIntent(req.model),
      ...(options.model !== undefined ? { model: options.model } : {}),
      ...(req.profile !== undefined ? { profile: req.profile } : {}),
      ...(req.project !== undefined ? { project: req.project } : {}),
      ...(req.params ? { params: req.params } : {}),
    };
    const res = await doFetch(`${baseUrl}/v1/infer`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: req.signal ?? null,
    });
    if (!res.ok) {
      const errorBody = await res.text();
      const common = {
        status: res.status,
        retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
        definitive: isDefinitiveStatus(res.status),
      };
      const wire = parseErrorBody(errorBody);
      if (wire) {
        throw new NolaProviderError(wire.message, {
          ...common,
          code: wire.code,
          ...(wire.details ? { details: wire.details } : {}),
        });
      }
      throw new NolaProviderError(`Nola API request failed: ${res.status} ${res.statusText} — ${errorBody.slice(0, 500)}`, common);
    }
    noticeUsage(res.headers);
    const data = (await res.json()) as Partial<NolaInferResponse>;
    if (typeof data.text !== "string") throw new NolaProviderError("Nola API response had no text.");
    return { text: data.text, durationMs: Date.now() - requestedAt };
  };

  const infer = async (req: InferRequest): Promise<ProviderResponse> => {
    let delay = retry.delayMs;
    let lastError: unknown;
    for (let attempt = 0; attempt <= retry.maxRetries; attempt++) {
      try {
        return await attemptOnce(req);
      } catch (error) {
        lastError = error;
        const definitive = error instanceof NolaProviderError && error.definitive === true;
        if (definitive || attempt === retry.maxRetries || req.signal?.aborted) throw error;
        const retryAfterMs = error instanceof NolaProviderError ? (error.retryAfterMs ?? 0) : 0;
        await sleep(Math.min(Math.max(delay, retryAfterMs), retry.maxDelayMs));
        delay = Math.min(delay * retry.multiplier, retry.maxDelayMs);
      }
    }
    throw lastError; // unreachable; satisfies control-flow analysis
  };

  return { name: "nola", infer, [PLATFORM_MODEL]: true };
}
